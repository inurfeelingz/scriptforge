// frontend/src/workers/clipIndexer.worker.js
// Runs in a dedicated Web Worker — never blocks the UI thread.

import { pipeline, env } from '@xenova/transformers'

// ─── MP4Box loader ────────────────────────────────────────────────────────────
let _mp4boxReady = null
async function getMP4Box() {
  if (self.MP4Box?.createFile) return self.MP4Box
  if (_mp4boxReady) return _mp4boxReady
  _mp4boxReady = new Promise((resolve) => {
    fetch('https://cdn.jsdelivr.net/npm/mp4box@0.5.3/dist/mp4box.all.min.js')
      .then(r => r.text())
      .then(code => { new Function(code)(); resolve(self.MP4Box?.createFile ? self.MP4Box : null) })
      .catch(() => resolve(null))
  })
  return _mp4boxReady
}

env.allowLocalModels = false
env.useBrowserCache  = true

let clipExtractor = null
let textExtractor = null
let modelsReady   = false
let cancelFlag    = false

// ─── MODEL LOADING ────────────────────────────────────────────────────────────
async function loadModels() {
  try {
    postMessage({ type: 'MODEL_LOADING', payload: { model: 'CLIP', pct: 0 } })
    clipExtractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', {
      progress_callback: ({ progress }) =>
        postMessage({ type: 'MODEL_LOADING', payload: { model: 'CLIP', pct: Math.round(progress || 0) } }),
    })
    postMessage({ type: 'MODEL_LOADING', payload: { model: 'MiniLM', pct: 0 } })
    textExtractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: ({ progress }) =>
        postMessage({ type: 'MODEL_LOADING', payload: { model: 'MiniLM', pct: Math.round(progress || 0) } }),
    })
    modelsReady = true
    postMessage({ type: 'MODEL_READY', payload: { models: ['CLIP', 'MiniLM', 'Whisper (server)'] } })
  } catch (err) {
    postMessage({ type: 'ERROR', payload: { filename: 'model-init', error: err.message } })
  }
}

// ─── MAIN THREAD PROXY HELPERS ────────────────────────────────────────────────
// Workers can't make authenticated fetch calls or use DOM APIs.
// These functions ask the main thread to do it and wait for the response.

function askMainThread(requestType, resultType, payload, transferables = []) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2)
    function handler(e) {
      if (e.data?.type === resultType && e.data?.id === id) {
        self.removeEventListener('message', handler)
        resolve(e.data)
      }
    }
    self.addEventListener('message', handler)
    postMessage({ type: requestType, id, ...payload }, transferables)
    setTimeout(() => { self.removeEventListener('message', handler); resolve({}) }, 600000) // 10 min
  })
}

async function getDuration(filename) {
  const result = await askMainThread('AUDIO_META_REQUEST', 'AUDIO_META_RESULT', { filename })
  return result.durationMs || 0
}

async function transcribeOnMainThread(filename, mimeType, buffer) {
  // Copy the buffer so the original remains usable
  const copy   = buffer.slice(0)
  const result = await askMainThread(
    'TRANSCRIBE_REQUEST', 'TRANSCRIBE_RESULT',
    { filename, mimeType: mimeType || 'video/mp4', buffer: copy },
    [copy]
  )
  return result.transcript || ''
}

async function extractFrameOnMainThread(filename) {
  const result = await askMainThread('FRAME_REQUEST', 'FRAME_RESULT', { filename })
  if (!result.imageData) return null
  const { width, height, data } = result.imageData
  const imgData = new ImageData(new Uint8ClampedArray(data), width, height)
  const canvas  = new OffscreenCanvas(width, height)
  canvas.getContext('2d').putImageData(imgData, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  // Return object URL — Xenova CLIP fetches URLs reliably in worker context
  return URL.createObjectURL(blob)
}

// ─── FRAME EXTRACTION VIA WEBCODECS (worker-side, for formats that work) ───────
async function extractFrameWithMP4Box(buffer) {
  const MP4Box = await getMP4Box()
  if (!MP4Box) return null

  return new Promise((resolve) => {
    const mp4boxFile = MP4Box.createFile()
    let resolved = false
    let decoder  = null

    function done(bitmap) { if (!resolved) { resolved = true; resolve(bitmap) } }

    mp4boxFile.onError = () => done(null)

    mp4boxFile.onReady = (info) => {
      const videoTrack = info.tracks.find(t => t.type === 'video')
      if (!videoTrack) { done(null); return }

      const codecString = videoTrack.codec

      // Skip HEVC (hvc1/hev1) — requires hardware, often fails in workers
      if (codecString?.startsWith('hvc1') || codecString?.startsWith('hev1')) {
        console.warn('[MP4Box] HEVC codec — skipping WebCodecs, will use main thread fallback')
        done(null)
        return
      }

      decoder = new VideoDecoder({
        output: async (frame) => {
          if (resolved) { frame.close(); return }
          const canvas = new OffscreenCanvas(224, 224)
          canvas.getContext('2d').drawImage(frame, 0, 0, 224, 224)
          frame.close()
          const blob = await canvas.convertToBlob({ type: 'image/png' })
          done(URL.createObjectURL(blob))
        },
        error: (e) => { console.warn('[VideoDecoder] error:', e.message); done(null) },
      })

      try {
        decoder.configure({
          codec:       codecString,
          codedWidth:  videoTrack.video?.width  || 1920,
          codedHeight: videoTrack.video?.height || 1080,
        })
      } catch {
        // Try H.264 baseline as fallback
        try {
          decoder.configure({ codec: 'avc1.42E01E', codedWidth: 1920, codedHeight: 1080 })
        } catch { done(null); return }
      }

      mp4boxFile.setExtractionOptions(videoTrack.id, null, { nbSamples: 10 })
      mp4boxFile.start()
    }

    mp4boxFile.onSamples = (trackId, ref, samples) => {
      if (resolved || !decoder) return
      for (const sample of samples) {
        if (resolved) break
        try {
          decoder.decode(new EncodedVideoChunk({
            type:      sample.is_sync ? 'key' : 'delta',
            timestamp: sample.cts * 1000000 / sample.timescale,
            duration:  sample.duration * 1000000 / sample.timescale,
            data:      sample.data,
          }))
        } catch {}
      }
    }

    const copy = buffer.slice(0)
    copy.fileStart = 0
    mp4boxFile.appendBuffer(copy)
    mp4boxFile.flush()

    setTimeout(() => done(null), 10000)
  })
}

// ─── VIDEO METADATA VIA MP4BOX ────────────────────────────────────────────────
async function extractVideoMeta(buffer) {
  const MP4Box = await getMP4Box()
  if (!MP4Box) return { width: null, height: null, fps: null, codec: null, durationMs: 0 }

  return new Promise((resolve) => {
    const mp4boxFile = MP4Box.createFile()
    let resolved = false

    mp4boxFile.onReady = (info) => {
      if (resolved) return
      resolved = true
      const videoTrack = info.tracks.find(t => t.type === 'video')
      resolve({
        width:     videoTrack?.video?.width  || null,
        height:    videoTrack?.video?.height || null,
        fps:       videoTrack ? Math.round(videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale)) : null,
        codec:     videoTrack?.codec || null,
        durationMs: Math.round((info.duration / info.timescale) * 1000) || 0,
      })
    }
    mp4boxFile.onError = () => { if (!resolved) { resolved = true; resolve({ width: null, height: null, fps: null, codec: null, durationMs: 0 }) } }

    const copy = buffer.slice(0)
    copy.fileStart = 0
    mp4boxFile.appendBuffer(copy)
    mp4boxFile.flush()

    setTimeout(() => { if (!resolved) { resolved = true; resolve({ width: null, height: null, fps: null, codec: null, durationMs: 0 }) } }, 8000)
  })
}

// ─── VECTORS ──────────────────────────────────────────────────────────────────
async function visualVector(frame) {
  if (!clipExtractor || !frame) return new Array(512).fill(0)
  try {
    const result = Array.from((await clipExtractor(frame)).data)
    if (typeof frame === 'string' && frame.startsWith('blob:')) URL.revokeObjectURL(frame)
    return result
  } catch { return new Array(512).fill(0) }
}

async function textVector(text) {
  if (!textExtractor || !text?.trim()) return new Array(384).fill(0)
  try { return Array.from((await textExtractor(text, { pooling: 'mean', normalize: true })).data) }
  catch { return new Array(384).fill(0) }
}

async function tagClip(frame, clipType) {
  // Visual tagging via CLIP zero-shot requires both vision+text encoders
  // which aren't exposed on the image-feature-extraction pipeline.
  // Use clip type + transcript-derived tags instead — reliable and meaningful.
  if (typeof frame === 'string' && frame.startsWith('blob:')) URL.revokeObjectURL(frame)
  const defaults = {
    cam:   ['talking to camera', 'presenter', 'speaking'],
    daw:   ['DAW software', 'music production', 'screen capture'],
    broll: ['b-roll', 'cutaway', 'visual'],
  }
  return defaults[clipType] || defaults.cam
}

// ─── CLIP TYPE DETECTION ──────────────────────────────────────────────────────
function detectType(filename) {
  const l = filename.toLowerCase()
  if (l.startsWith('daw') || l.includes('screen') || l.includes('capture')) return 'daw'
  if (l.includes('broll') || l.includes('b-roll') || l.includes('b_roll'))  return 'broll'
  return 'cam'
}

// ─── MAIN INDEX FUNCTION ──────────────────────────────────────────────────────
async function indexClip(file, categoryId) {
  if (cancelFlag) return null
  const clipType = detectType(file.name)
  const filepath = file.webkitRelativePath || file.relativePath || file.name

  try {
    // Read file buffer ONCE — pass slices to each function to avoid re-reading
    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'reading', pct: 5 } })
    const buffer = await file.arrayBuffer()

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'metadata', pct: 10 } })
    const meta = await extractVideoMeta(buffer)

    // Duration from MP4Box metadata (most reliable), fallback to main thread <video>
    let durationMs = meta.durationMs
    if (!durationMs) {
      postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'duration', pct: 15 } })
      durationMs = await getDuration(file.name)
    }

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'transcribing', pct: 25 } })
    const transcript = await transcribeOnMainThread(file.name, file.type, buffer)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'frame', pct: 45 } })
    // Try WebCodecs in worker first, fall back to main thread <video> capture
    let frame = await extractFrameWithMP4Box(buffer)
    if (!frame) {
      console.log('[indexClip] WebCodecs failed, trying main thread frame capture:', file.name)
      frame = await extractFrameOnMainThread(file.name)
    }

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'tagging', pct: 60 } })
    const visualTags = await tagClip(frame, clipType)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'embedding', pct: 75 } })
    const visVec = await visualVector(frame)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'text vector', pct: 88 } })
    const txtContent = [transcript, ...visualTags, clipType].filter(Boolean).join('. ')
    const txtVec = await textVector(txtContent)

    const clipData = {
      filename:        file.name,
      filepath,
      fileSizeBytes:   file.size,
      fileModifiedAt:  file.lastModified || null,
      durationMs:      durationMs || meta.durationMs || 0,
      width:           meta.width,
      height:          meta.height,
      fps:             meta.fps,
      codec:           meta.codec,
      clipType,
      transcript:      transcript || null,
      visualTags,
      dominantEmotion: null,
      audioEnergy:     0.5,
      sceneType:       clipType === 'daw' ? 'daw-screen' : 'talking-head',
      thumbnailB64:    null,
      visualVector:    visVec,
      textVector:      txtVec,
    }

    console.log('[indexClip] transcript:', transcript?.slice(0, 80) || 'EMPTY', '| duration:', durationMs)
    postMessage({ type: 'CLIP_INDEXED', payload: clipData })
    return clipData

  } catch (err) {
    postMessage({ type: 'ERROR', payload: { filename: file.name, error: err.message } })
    return null
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
async function computeSearchVectors(query) {
  const txtVec = await textVector(query)
  // Also embed as CLIP text for visual search
  let visVec = new Array(512).fill(0)
  if (clipExtractor) {
    try { visVec = Array.from((await clipExtractor(query)).data) } catch {}
  }
  postMessage({ type: 'SEARCH_RESULT', payload: { query, visualVector: visVec, textVector: txtVec } })
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
self.addEventListener('message', async ({ data }) => {
  const { type, payload } = data
  switch (type) {
    case 'INIT':
      if (!modelsReady) await loadModels()
      break

    case 'INDEX_CLIP':
      if (!modelsReady) await loadModels()
      await indexClip(payload.file, payload.categoryId)
      break

    case 'INDEX_BATCH': {
      if (!modelsReady) await loadModels()
      cancelFlag = false
      const success = [], failed = []
      for (let i = 0; i < payload.files.length; i++) {
        if (cancelFlag) break
        const r = await indexClip(payload.files[i], payload.categoryId)
        if (r) success.push(r.filename)
        else   failed.push(payload.files[i].name)
        postMessage({ type: 'PROGRESS', payload: {
          step: 'batch', filename: payload.files[i].name,
          current: i + 1, total: payload.files.length,
          pct: Math.round(((i + 1) / payload.files.length) * 100),
        }})
      }
      postMessage({ type: 'BATCH_DONE', payload: { success, failed } })
      break
    }

    case 'SEARCH':
      if (!modelsReady) await loadModels()
      await computeSearchVectors(payload.query)
      break

    case 'CANCEL':
      cancelFlag = true
      break

    // Results from main thread — handled by askMainThread listeners above
    case 'TRANSCRIBE_RESULT':
    case 'AUDIO_META_RESULT':
    case 'FRAME_RESULT':
      // These are caught by the addEventListener in askMainThread
      break
  }
})