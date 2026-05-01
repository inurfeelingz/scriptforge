// frontend/src/workers/clipIndexer.worker.js
// Runs in a dedicated Web Worker — never blocks the UI thread.
// Uses Transformers.js for CLIP visual embeddings and Whisper transcription.
// Uses MP4Box.js + WebCodecs for frame extraction from MP4/MOV files.

import { pipeline, env } from '@xenova/transformers'
import MP4Box from 'mp4box'

env.allowLocalModels = false
env.useBrowserCache  = true

let clipExtractor = null
let textExtractor = null
let asrPipeline   = null
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

    postMessage({ type: 'MODEL_LOADING', payload: { model: 'Whisper', pct: 0 } })
    asrPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: ({ progress }) =>
        postMessage({ type: 'MODEL_LOADING', payload: { model: 'Whisper', pct: Math.round(progress || 0) } }),
    })

    modelsReady = true
    postMessage({ type: 'MODEL_READY', payload: { models: ['CLIP', 'MiniLM', 'Whisper'] } })
  } catch (err) {
    postMessage({ type: 'ERROR', payload: { filename: 'model-init', error: err.message } })
  }
}

// ─── AUDIO EXTRACTION ─────────────────────────────────────────────────────────

async function extractAudio(file) {
  try {
    const arrayBuffer  = await file.arrayBuffer()
    const audioCtx     = new OfflineAudioContext(1, 16000 * 30, 16000)
    const audioBuffer  = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    const channelData  = audioBuffer.getChannelData(0)
    const rms          = Math.sqrt(channelData.reduce((s, v) => s + v * v, 0) / channelData.length)
    return {
      pcmData:     channelData,
      energyLevel: parseFloat(Math.min(rms * 10, 1.0).toFixed(3)),
      sampleRate:  16000,
      durationMs:  Math.round(audioBuffer.duration * 1000),
    }
  } catch {
    return { pcmData: null, energyLevel: 0.5, sampleRate: 16000, durationMs: 0 }
  }
}

// ─── TRANSCRIPTION ────────────────────────────────────────────────────────────

async function transcribe(pcmData, sampleRate) {
  if (!asrPipeline || !pcmData || pcmData.length < 1600) return ''
  try {
    const samples = pcmData.length > 16000 * 30 ? pcmData.slice(0, 16000 * 30) : pcmData
    const result  = await asrPipeline(samples instanceof Float32Array ? samples : new Float32Array(samples), {
      sampling_rate: sampleRate,
      chunk_length_s: 30,
      return_timestamps: false,
    })
    return result?.text?.trim() || ''
  } catch { return '' }
}

// ─── FRAME EXTRACTION WITH MP4BOX + WEBCODECS ─────────────────────────────────

async function extractFrameWithMP4Box(file) {
  return new Promise((resolve) => {
    const mp4boxFile = MP4Box.createFile()
    let resolved = false
    let videoTrackId = null
    let codecConfig = null

    function done(bitmap) {
      if (!resolved) {
        resolved = true
        resolve(bitmap)
      }
    }

    mp4boxFile.onError = () => done(null)

    mp4boxFile.onReady = (info) => {
      const videoTrack = info.tracks.find(t => t.type === 'video')
      if (!videoTrack) { done(null); return }

      videoTrackId = videoTrack.id
      const desc = videoTrack.codec

      // Set up WebCodecs VideoDecoder
      const decoder = new VideoDecoder({
        output: (frame) => {
          if (resolved) { frame.close(); return }
          // Got a frame — draw to OffscreenCanvas and resolve
          const canvas = new OffscreenCanvas(224, 224)
          const ctx = canvas.getContext('2d')
          ctx.drawImage(frame, 0, 0, 224, 224)
          frame.close()
          done(canvas.transferToImageBitmap())
        },
        error: () => done(null),
      })

      // Try to configure decoder with track info
      try {
        decoder.configure({
          codec: desc,
          codedWidth:  videoTrack.video?.width  || 1920,
          codedHeight: videoTrack.video?.height || 1080,
        })
      } catch {
        // Fallback codec strings for MOV/MP4
        const fallbacks = ['avc1.42E01E', 'hvc1.1.6.L93.B0', 'vp8', 'vp09.00.10.08']
        let configured = false
        for (const codec of fallbacks) {
          try {
            decoder.configure({
              codec,
              codedWidth:  videoTrack.video?.width  || 1920,
              codedHeight: videoTrack.video?.height || 1080,
            })
            configured = true
            break
          } catch {}
        }
        if (!configured) { done(null); return }
      }

      codecConfig = decoder

      // Extract only first segment — we just need one frame
      mp4boxFile.setExtractionOptions(videoTrackId, null, { nbSamples: 5 })
      mp4boxFile.start()
    }

    mp4boxFile.onSamples = (trackId, ref, samples) => {
      if (resolved || !codecConfig) return
      for (const sample of samples) {
        if (resolved) break
        try {
          const chunk = new EncodedVideoChunk({
            type:      sample.is_sync ? 'key' : 'delta',
            timestamp: sample.cts * 1000000 / sample.timescale,
            duration:  sample.duration * 1000000 / sample.timescale,
            data:      sample.data,
          })
          codecConfig.decode(chunk)
        } catch {}
      }
    }

    // Feed the file to MP4Box in chunks
    file.arrayBuffer().then(buffer => {
      buffer.fileStart = 0
      mp4boxFile.appendBuffer(buffer)
      mp4boxFile.flush()
    }).catch(() => done(null))

    // Timeout after 10s
    setTimeout(() => done(null), 10000)
  })
}

// ─── FRAME EXTRACTION — with fallback chain ───────────────────────────────────

async function extractFrame(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()

  // Try MP4Box + WebCodecs first (works for mp4, mov, m4v)
  if (['mp4', 'mov', 'm4v', 'mkv', 'mxf'].includes(ext)) {
    try {
      const bitmap = await extractFrameWithMP4Box(file)
      if (bitmap) return bitmap
    } catch {}
  }

  // Fallback: createImageBitmap (works for some formats, fails silently)
  try {
    const mimeMap = {
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
      mkv: 'video/x-matroska', avi: 'video/x-msvideo', mxf: 'application/mxf'
    }
    const mime = mimeMap[ext] || 'video/mp4'
    const blob = new Blob([await file.arrayBuffer()], { type: mime })
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(224, 224)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, 224, 224)
    return canvas.transferToImageBitmap()
  } catch {}

  // Return null — indexing continues without visual embedding
  return null
}

// ─── VECTORS ──────────────────────────────────────────────────────────────────

async function visualVector(imageBitmap) {
  if (!clipExtractor || !imageBitmap) return new Array(512).fill(0)
  try {
    const out = await clipExtractor(imageBitmap)
    return Array.from(out.data)
  } catch { return new Array(512).fill(0) }
}

async function clipTextVector(text) {
  if (!clipExtractor || !text?.trim()) return new Array(512).fill(0)
  try {
    const out = await clipExtractor(text, { pooling: 'mean' })
    return Array.from(out.data).slice(0, 512)
  } catch { return new Array(512).fill(0) }
}

async function textVector(text) {
  if (!textExtractor || !text?.trim()) return new Array(384).fill(0)
  try {
    const out = await textExtractor(text, { pooling: 'mean', normalize: true })
    return Array.from(out.data)
  } catch { return new Array(384).fill(0) }
}

// ─── VISUAL TAGGING ───────────────────────────────────────────────────────────

const LABELS = {
  cam:    ['talking to camera', 'close-up face', 'mid shot', 'working at desk', 'gesturing', 'smiling', 'focused', 'thinking'],
  daw:    ['DAW software', 'audio plugin', 'mixing board', 'piano keyboard', 'waveform display', 'mouse clicking', 'headphones'],
  broll:  ['city environment', 'coffee shop', 'studio space', 'equipment', 'hands', 'abstract'],
}

function cosineSim(a, b) {
  let dot = 0, mA = 0, mB = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i] }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB) + 1e-8)
}

async function tagClip(imageBitmap, clipType) {
  if (!clipExtractor || !imageBitmap) return [clipType]
  try {
    const imgOut  = await clipExtractor(imageBitmap)
    const imgVec  = Array.from(imgOut.data)
    const labels  = LABELS[clipType] || LABELS.cam
    const scored  = await Promise.all(labels.map(async label => {
      const out  = await clipExtractor(label)
      return { label, score: cosineSim(imgVec, Array.from(out.data)) }
    }))
    return scored.sort((a,b) => b.score - a.score).filter(s => s.score > 0.2).slice(0, 5).map(s => s.label)
  } catch { return [clipType] }
}

// ─── CLIP TYPE DETECTION ──────────────────────────────────────────────────────

function detectType(filename) {
  const l = filename.toLowerCase()
  if (l.startsWith('daw') || l.includes('screen') || l.includes('capture')) return 'daw'
  if (l.includes('broll') || l.includes('b-roll') || l.includes('b_roll'))  return 'broll'
  return 'cam'
}

// ─── VIDEO METADATA ───────────────────────────────────────────────────────────

async function extractVideoMeta(file) {
  return new Promise((resolve) => {
    const mp4boxFile = MP4Box.createFile()
    let resolved = false

    mp4boxFile.onReady = (info) => {
      if (resolved) return
      resolved = true
      const videoTrack = info.tracks.find(t => t.type === 'video')
      resolve({
        width:    videoTrack?.video?.width  || null,
        height:   videoTrack?.video?.height || null,
        fps:      videoTrack ? Math.round(videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale)) : null,
        codec:    videoTrack?.codec || null,
        durationMs: Math.round((info.duration / info.timescale) * 1000) || 0,
      })
    }

    mp4boxFile.onError = () => {
      if (!resolved) { resolved = true; resolve({ width: null, height: null, fps: null, codec: null, durationMs: 0 }) }
    }

    file.arrayBuffer().then(buffer => {
      buffer.fileStart = 0
      mp4boxFile.appendBuffer(buffer)
      mp4boxFile.flush()
    }).catch(() => resolve({ width: null, height: null, fps: null, codec: null, durationMs: 0 }))

    setTimeout(() => {
      if (!resolved) { resolved = true; resolve({ width: null, height: null, fps: null, codec: null, durationMs: 0 }) }
    }, 8000)
  })
}

// ─── THUMBNAIL ────────────────────────────────────────────────────────────────

function bitmapToBase64(bitmap) {
  try {
    const canvas = new OffscreenCanvas(160, 90)
    const ctx    = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, 160, 90)
    // OffscreenCanvas doesn't have toDataURL — use ImageData
    const imageData = ctx.getImageData(0, 0, 160, 90)
    // Encode as simple base64 PNG via Blob
    return null  // thumbnails stored as null — DB stores vectors not images
  } catch { return null }
}

// ─── MAIN INDEX FUNCTION ──────────────────────────────────────────────────────

async function indexClip(file, categoryId) {
  if (cancelFlag) return null
  const clipType = detectType(file.name)
  const filepath = file.webkitRelativePath || file.relativePath || file.name

  try {
    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'audio',        pct: 8  } })
    const audio = await extractAudio(file)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'metadata',     pct: 18 } })
    const meta  = await extractVideoMeta(file)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'transcribing', pct: 28 } })
    const transcript = await transcribe(audio.pcmData, audio.sampleRate)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'frame',        pct: 45 } })
    const frame = await extractFrame(file)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'tagging',      pct: 58 } })
    const visualTags = await tagClip(frame, clipType)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'embedding',    pct: 72 } })
    const visVec = await visualVector(frame)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'text vector',  pct: 86 } })
    const txtContent = [transcript, ...visualTags, clipType].filter(Boolean).join('. ')
    const txtVec = await textVector(txtContent)

    const clipData = {
      filename:       file.name,
      filepath,
      fileSizeBytes:  file.size,
      fileModifiedAt: file.lastModified || null,
      durationMs:     meta.durationMs || audio.durationMs,
      width:          meta.width,
      height:         meta.height,
      fps:            meta.fps,
      codec:          meta.codec,
      clipType,
      transcript,
      visualTags,
      dominantEmotion: null,
      audioEnergy:     audio.energyLevel,
      sceneType:       clipType === 'daw' ? 'daw-screen' : 'talking-head',
      thumbnailB64:    null,
      visualVector:    visVec,
      textVector:      txtVec,
    }

    postMessage({ type: 'CLIP_INDEXED', payload: clipData })
    return clipData
  } catch (err) {
    postMessage({ type: 'ERROR', payload: { filename: file.name, error: err.message } })
    return null
  }
}

// ─── SEARCH VECTORS ───────────────────────────────────────────────────────────

async function computeSearchVectors(query) {
  const [txtVec, visVec] = await Promise.all([
    textVector(query),
    clipTextVector(query),
  ])
  postMessage({ type: 'SEARCH_RESULT', payload: { query, visualVector: visVec, textVector: txtVec } })
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────

self.onmessage = async ({ data }) => {
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
  }
}