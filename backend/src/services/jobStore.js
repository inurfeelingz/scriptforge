// backend/src/services/jobStore.js
// Supabase-backed job store — survives Railway restarts.
// Drop-in replacement for in-memory Maps.
// Jobs expire after TTL (default 2 hours).

const { supabase } = require('../utils/supabase')

const TTL_MS = 2 * 60 * 60 * 1000  // 2 hours

class JobStore {
  constructor(type) {
    this.type    = type          // e.g. 'edl', 'shorts', 'moments', 'indexing'
    this.cache   = new Map()     // L1: in-memory for speed
    this.syncInterval = null
  }

  _key(jobId) { return this.type + ':' + jobId }

  // Get a job — check memory first, then DB
  async get(jobId) {
    if (this.cache.has(jobId)) return this.cache.get(jobId)
    try {
      const { data } = await supabase
        .from('processing_jobs')
        .select('data, status, updated_at')
        .eq('job_id', this._key(jobId))
        .single()
      if (!data) return null
      // Check TTL
      if (Date.now() - new Date(data.updated_at).getTime() > TTL_MS) {
        await this.delete(jobId)
        return null
      }
      const job = { ...data.data, status: data.status }
      this.cache.set(jobId, job)
      return job
    } catch { return null }
  }

  // Set a job — write to memory and DB
  async set(jobId, value) {
    this.cache.set(jobId, value)
    try {
      await supabase.from('processing_jobs').upsert({
        job_id:     this._key(jobId),
        job_type:   this.type,
        status:     value.status || 'processing',
        data:       value,
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      }, { onConflict: 'job_id' })
    } catch (e) {
      console.warn('[jobStore] DB write failed for', jobId, e.message)
    }
    return value
  }

  // Update specific fields without reading first
  async update(jobId, fields) {
    const current = await this.get(jobId)
    if (!current) return null
    const updated = { ...current, ...fields }
    await this.set(jobId, updated)
    return updated
  }

  // Delete a job
  async delete(jobId) {
    this.cache.delete(jobId)
    try {
      await supabase.from('processing_jobs').delete().eq('job_id', this._key(jobId))
    } catch {}
  }

  // Check if exists
  async has(jobId) {
    const job = await this.get(jobId)
    return job !== null
  }

  // Cleanup expired jobs (call periodically)
  async cleanup() {
    try {
      await supabase.from('processing_jobs')
        .delete()
        .eq('job_type', this.type)
        .lt('expires_at', new Date().toISOString())
      // Also clean memory cache
      for (const [id, job] of this.cache.entries()) {
        if (job._expiresAt && Date.now() > job._expiresAt) this.cache.delete(id)
      }
    } catch {}
  }
}

// Singleton instances — one per job type
const stores = {}
function getStore(type) {
  if (!stores[type]) stores[type] = new JobStore(type)
  return stores[type]
}

// Cleanup expired jobs every 30 minutes
setInterval(() => {
  Object.values(stores).forEach(s => s.cleanup())
}, 30 * 60 * 1000)

module.exports = { JobStore, getStore }