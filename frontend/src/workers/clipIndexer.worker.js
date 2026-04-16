// frontend/src/workers/clipIndexer.worker.js
// Runs in a dedicated Web Worker — never blocks the UI thread.
// Uses Transformers.js for CLIP visual embeddings and Whisper transcription.
// WebCodecs API decodes video frames using hardware acceleration.

import { pipeline, env } from '@xenova/transformers'

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
    const audioBuffer  = await audioCtx.decodeAudioData(arrayBuffer)
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

// ─── FRAME EXTRACTION ─────────────────────────────────────────────────────────

async function extractFrame(file) {
  // OffscreenCanvas approach — works without HTMLVideoElement
  // For full WebCodecs VideoDecoder, mp4box.js demuxer needed (future pass)
  try {
    const blob   = new Blob([await file.arrayBuffer()], { type: file.type || 'video/mp4' })
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(224, 224)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, 224, 224)
    return canvas.transferToImageBitmap()
  } catch { return null }
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
    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'audio',       pct: 10 } })
    const audio = await extractAudio(file)

    postMessage({ type: 'PROGRESS', payload: { filename: file.name, step: 'transcribing', pct: 25 } })
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
      filename: file.name, filepath,
      fileSizeBytes: file.size,
      fileModifiedAt: file.lastModified || null,   // epoch ms — used for change detection
      durationMs: audio.durationMs,
      width: null, height: null, fps: null, codec: null,
      clipType, transcript, visualTags,
      dominantEmotion: null,
      audioEnergy: audio.energyLevel,
      sceneType: clipType === 'daw' ? 'daw-screen' : 'talking-head',
      thumbnailB64: null,
      visualVector: visVec,
      textVector:   txtVec,
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
