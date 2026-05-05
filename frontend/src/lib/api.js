// frontend/src/lib/api.js
// Centralised API client. All calls go through here.
// Token is injected automatically from Supabase session.

import { getSession } from './supabase'

const BASE = import.meta.env.VITE_API_URL || '/api'

async function getHeaders() {
  const session = await getSession()
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  }
}

async function req(method, path, body) {
  const headers = await getHeaders()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body && { body: JSON.stringify(body) }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

async function reqForm(path, formData) {
  const session = await getSession()
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token}` },
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Upload failed: ${res.status}`)
  }
  return res.json()
}

// ── SSE streaming helper ──────────────────────────────────────────────────────
// Returns an EventSource-like object that handles auth via fetch + ReadableStream

export async function streamRequest(path, body, handlers = {}, signal = null) {
  const session = await getSession()

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  }
  if (signal) fetchOptions.signal = signal

  const response = await fetch(`${BASE}${path}`, fetchOptions)

  if (!response.ok) throw new Error(`Stream failed: ${response.status}`)

  const reader  = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Listen for abort — cancel the reader immediately
  if (signal) {
    signal.addEventListener('abort', () => { reader.cancel().catch(() => {}) }, { once: true })
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal?.aborted) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop()

      for (const part of parts) {
        if (!part.trim() || part.startsWith(':')) continue
        let event = null
        let data  = null
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim()
          if (line.startsWith('data: '))  data  = line.slice(6).trim()
        }
        if (event && data) {
          try { handlers[event]?.(JSON.parse(data)) } catch {}
        }
      }
    }
  } catch (err) {
    // AbortError is expected when signal fires — don't propagate it
    if (err.name !== 'AbortError') throw err
  } finally {
    reader.cancel().catch(() => {})
  }
}

// ── Categories ────────────────────────────────────────────────────────────────
export const categories = {
  list:    ()         => req('GET', '/categories'),
  get:     (id)       => req('GET', `/categories/${id}`),
  create:  (body)     => req('POST', '/categories', body),
  update:  (id, body) => req('PATCH', `/categories/${id}`, body),
  delete:  (id)       => req('DELETE', `/categories/${id}`),
  switch:  (id)       => req('POST', `/categories/${id}/switch`),
  refresh: (id)       => req('POST', `/categories/${id}/refresh`),
}

// ── Episodes ──────────────────────────────────────────────────────────────────
export const episodes = {
  list:        (params)   => req('GET', `/episodes?${new URLSearchParams(params)}`),
  get:         (id)       => req('GET', `/episodes/${id}`),
  updateStatus:(id, body) => req('PATCH', `/episodes/${id}/status`, body),
  logPerf:     (id, body) => req('PATCH', `/episodes/${id}/performance`, body),
  generate:    (body, handlers) => streamRequest('/episodes/generate', body, handlers),
  duplicate:   (id)       => req('POST', `/episodes/${id}/duplicate`),
  usage:       ()          => req('GET',  '/episodes/usage'),
  hookVariants:(body)      => req('POST', '/episodes/hook-variants', body),
  regenerateSection: (id, section, handlers) => streamRequest(`/episodes/${id}/regenerate-section`, { section }, handlers),
}

// ── Vault ─────────────────────────────────────────────────────────────────────
export const dashboard = {
  brief:         (categoryId)      => req('GET', `/dashboard/brief?categoryId=${categoryId}`),
  pipeline:      (categoryId)      => req('GET', `/dashboard/pipeline?categoryId=${categoryId}`),
  advanceStatus: (id, status)      => req('PATCH', `/dashboard/pipeline/${id}/status`, { status }),
}

export const vault = {
  list:          (params) => req('GET', `/vault?${new URLSearchParams(params)}`),
  stats:         (params) => req('GET', `/vault/stats?${new URLSearchParams(params)}`),
  recommendations:(params)=> req('GET', `/vault/recommendations?${new URLSearchParams(params)}`),
  create:        (body)   => req('POST', '/vault', body),
  update:        (id, body)=> req('PATCH', `/vault/${id}`, body),
  favourite:     (id)     => req('POST', `/vault/${id}/favourite`),
  delete:        (id)     => req('DELETE', `/vault/${id}`),
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export const billing = {
  plans:     ()            => req('GET',  '/billing/plans'),
  status:    ()            => req('GET',  '/billing/status'),
  subscribe: (planKey)     => req('POST', '/billing/subscribe', { planKey }),
  cancel:    ()            => req('POST', '/billing/cancel', {}),
}

export const analytics = {
  list:      (params) => req('GET', `/analytics?${new URLSearchParams(params)}`),
  hookStats: (params) => req('GET', `/analytics/hook-stats?${new URLSearchParams(params)}`),
  upload: async (file, categoryId, platform, skipInsights = false) => {
    const session = await getSession()
    const formData = new FormData()
    formData.append('file', file)
    formData.append('categoryId', categoryId)
    formData.append('platform', platform)
    if (skipInsights) formData.append('skip_insights', 'true')
    const res = await fetch(`${BASE}/analytics/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body: formData,
    })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    return res.json()
  },
  // YouTube OAuth
  youtubeStatus:     (categoryId) => req('GET',  `/analytics/youtube/status?categoryId=${categoryId}`),
  youtubeConnectUrl: async (categoryId) => {
    const session = await getSession()
    const token = session?.access_token || ''
    return `${BASE}/analytics/youtube/connect?categoryId=${categoryId}&token=${token}`
  },
  youtubePull:       (categoryId) => req('POST', '/analytics/youtube/pull', { categoryId }),
  youtubeDisconnect: (categoryId) => req('DELETE', `/analytics/youtube/disconnect?categoryId=${categoryId}`),
  // Episode retention
  episodeRetention:  (episodeId)  => req('GET',  `/analytics/episode/${episodeId}/retention`),
  saveRetentionCurve:(id, data)   => req('POST', `/analytics/episode/${id}/retention-curve`, { curveData: data }),
}

// ── Series ────────────────────────────────────────────────────────────────────
export const series = {
  list:   (params) => req('GET', `/series?${new URLSearchParams(params)}`),
  update: (id, body)=> req('PATCH', `/series/${id}`, body),
}

export const shorts = {
  generate:        (episodeId, categoryId) => req('POST', '/shorts/generate',   { episodeId, categoryId }),
  thumbnails:      (episodeId, categoryId) => req('POST', '/shorts/thumbnails', { episodeId, categoryId }),
  get:             (episodeId)             => req('GET',  `/shorts/${episodeId}`),
  bible:           (categoryId, force)     => req('GET',  `/shorts/bible/${categoryId}${force ? '?force=true' : ''}`),
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export const chat = {
  send:             (body, handlers, signal) => streamRequest('/chat/message', body, handlers, signal),
  getHistory:       (params) => req('GET', `/chat/history?${new URLSearchParams(params)}`),
  clearHistory:     (body)   => req('DELETE', '/chat/history', body),
  commitEpisode:    (body)   => req('POST', '/chat/commit-episode', body),
  getSessions:      (params) => req('GET', `/chat/sessions?${new URLSearchParams(params)}`),
  getSession:       (id)     => req('GET', `/chat/sessions/${id}`),
  saveSession:      (body)   => req('POST', '/chat/sessions', body),
  deleteSession:    (id)     => req('DELETE', `/chat/sessions/${id}`),
  generateEpisode:  (body, handlers, signal) => streamRequest('/chat/generate-episode', body, handlers, signal),
}

// ── Refresh ───────────────────────────────────────────────────────────────────
export const refresh = {
  status: (categoryId) => req('GET', `/refresh/status?categoryId=${categoryId}`),
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = {
  profile:     ()     => req('GET', '/users/profile'),
  updateProfile:(body) => req('PATCH', '/users/profile', body),
  checkInvite: (code) => req('GET', `/users/invite/${code}`),
  list:        ()     => req('GET', '/admin/users'),
  setTier:     (id, tier) => req('PATCH', `/admin/users/${id}/tier`, { tier }),
  resetUsage:  (id)   => req('POST', `/admin/reset-usage/${id}`),
}

// ── Sound library ────────────────────────────────────────────────────────────
export const sound = {
  getLibrary:      (categoryId)          => req('GET',    `/sound/library?categoryId=${categoryId}`),
  listAssets:      (params = {})         => req('GET',    `/sound/assets?${new URLSearchParams(params)}`),
  uploadAsset:     (formData)            => reqForm('/sound/assets', formData),
  getAssetUrl:     (id)                  => req('GET',    `/sound/assets/${id}/url`),
  updateAsset:     (id, body)            => req('PATCH',  `/sound/assets/${id}`, body),
  deleteAsset:     (id, force)           => req('DELETE', `/sound/assets/${id}${force ? '?force=true' : ''}`),
  designEpisode:   (episodeId, body)     => req('POST',   `/sound/episodes/${episodeId}/design`, body),
  getPlacements:   (episodeId)           => req('GET',    `/sound/episodes/${episodeId}/placements`),
  exportEDL:       (episodeId)           => `${BASE}/sound/episodes/${episodeId}/export-edl`,
  lockPlacement:   (epId, pId, locked)  => req('PATCH', `/sound/episodes/${epId}/placements/${pId}/lock`, { locked }),
}

// ── Sessions (companion app) ──────────────────────────────────────────────────
export const sessions = {
  create:  (body)     => req('POST',  '/session', body),
  list:    (params)   => req('GET',   `/session?${new URLSearchParams(params)}`),
  get:     (id)       => req('GET',   `/session/${id}`),
  addEntry:(id, body) => req('POST',  `/session/${id}/entry`, body),
  batch:   (id, body) => req('POST',  `/session/${id}/entries/batch`, body),
  process: (id)       => req('POST',  `/session/${id}/process`),
  link:    (id, body) => req('PATCH', `/session/${id}/link`, body),
  delete:  (id)       => req('DELETE',`/session/${id}`),
}

export const testWebhook = () => req('POST', '/test-webhook')

// ── Generic REST helper (used by editor + vision engine) ──────────────────────
// Provides api.get(), api.post(), api.patch(), api.delete()
// for components that don't need named resource clients

export const api = {
  get:    (path)        => req('GET',    path),
  post:   (path, body)  => req('POST',   path, body),
  patch:  (path, body)  => req('PATCH',  path, body),
  delete: (path, body)  => req('DELETE', path, body),
}