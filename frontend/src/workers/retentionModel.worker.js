// frontend/src/workers/retentionModel.worker.js
// Trains and runs the personal retention classifier entirely in the browser.
// Uses TensorFlow.js — no GPU cost, no cloud, runs on your hardware.
// After ~20 episodes with analytics, this model knows your audience
// better than any generic tool can.

// Message protocol:
// IN:  { type: 'TRAIN', payload: { examples } }
//      { type: 'PREDICT', payload: { features } }
//      { type: 'SAVE' }
//      { type: 'LOAD', payload: { weights } }
// OUT: { type: 'TRAINING_PROGRESS', payload: { epoch, loss, accuracy } }
//      { type: 'TRAINING_DONE',     payload: { accuracy, loss, epochs } }
//      { type: 'PREDICTION',        payload: { score, confidence, retained } }
//      { type: 'MODEL_SAVED',       payload: { weights } }
//      { type: 'ERROR',             payload: { message } }

import * as tf from '@tensorflow/tfjs'

let model  = null
let trained = false

// ─── MODEL ARCHITECTURE ───────────────────────────────────────────────────────
// Lightweight binary classifier:
// Input: 5 features [audioEnergy, timelinePosition, isCam, isDAW, isBroll]
// Hidden: 16 → 8 neurons with ReLU
// Output: 1 sigmoid neuron (probability of retention)
// This is intentionally tiny — we have limited training data (20-200 examples)
// and a simple feature space. Overfitting is the main risk.

function buildModel() {
  const m = tf.sequential()

  m.add(tf.layers.dense({
    units:           16,
    activation:      'relu',
    inputShape:      [5],
    kernelInitializer: 'glorotNormal',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }), // prevent overfitting
  }))

  m.add(tf.layers.dropout({ rate: 0.3 }))

  m.add(tf.layers.dense({
    units:      8,
    activation: 'relu',
  }))

  m.add(tf.layers.dense({
    units:      1,
    activation: 'sigmoid',
  }))

  m.compile({
    optimizer: tf.train.adam(0.001),
    loss:      'binaryCrossentropy',
    metrics:   ['accuracy'],
  })

  return m
}

// ─── TRAINING ─────────────────────────────────────────────────────────────────

async function trainModel(examples) {
  if (!examples?.length || examples.length < 10) {
    postMessage({ type: 'ERROR', payload: { message: `Need at least 10 examples (have ${examples?.length || 0})` } })
    return
  }

  // Check class balance — warn if heavily imbalanced
  const positives = examples.filter(e => e.label === 1).length
  const balance   = positives / examples.length
  if (balance < 0.2 || balance > 0.8) {
    postMessage({ type: 'TRAINING_PROGRESS', payload: {
      epoch: 0, loss: 0, accuracy: 0,
      warning: `Class imbalance detected (${Math.round(balance * 100)}% positive) — predictions may be biased`
    }})
  }

  // Prepare tensors
  const features = tf.tensor2d(examples.map(e => e.features))
  const labels   = tf.tensor2d(examples.map(e => [e.label]))

  model   = buildModel()
  trained = false

  let bestAccuracy = 0
  let finalLoss    = 0

  // Use early stopping via manual epoch monitoring
  const EPOCHS        = 100
  const PATIENCE      = 15
  let   epochsNoImprove = 0
  let   bestWeights     = null

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const history = await model.fit(features, labels, {
      epochs:          1,
      batchSize:       Math.min(32, Math.floor(examples.length / 2)),
      validationSplit: examples.length >= 30 ? 0.2 : 0,
      shuffle:         true,
      verbose:         0,
    })

    const acc  = history.history.acc?.[0] || history.history.accuracy?.[0] || 0
    const loss = history.history.loss?.[0] || 0

    postMessage({ type: 'TRAINING_PROGRESS', payload: {
      epoch:    epoch + 1,
      total:    EPOCHS,
      loss:     parseFloat(loss.toFixed(4)),
      accuracy: parseFloat((acc * 100).toFixed(1)),
      pct:      Math.round(((epoch + 1) / EPOCHS) * 100),
    }})

    // Track best
    if (acc > bestAccuracy) {
      bestAccuracy    = acc
      finalLoss       = loss
      epochsNoImprove = 0
      bestWeights     = model.getWeights().map(w => w.arraySync())
    } else {
      epochsNoImprove++
    }

    // Early stopping
    if (epochsNoImprove >= PATIENCE) {
      console.log(`[retentionModel] Early stopping at epoch ${epoch + 1}`)
      break
    }
  }

  // Restore best weights
  if (bestWeights) {
    const weightTensors = bestWeights.map(w => tf.tensor(w))
    model.setWeights(weightTensors)
    weightTensors.forEach(t => t.dispose())
  }

  // Clean up tensors
  features.dispose()
  labels.dispose()

  trained = true

  postMessage({ type: 'TRAINING_DONE', payload: {
    accuracy:  parseFloat((bestAccuracy * 100).toFixed(1)),
    loss:      parseFloat(finalLoss.toFixed(4)),
    examples:  examples.length,
    positives: examples.filter(e => e.label === 1).length,
    message:   `Model trained on ${examples.length} clips — ${parseFloat((bestAccuracy * 100).toFixed(1))}% accuracy`,
  }})
}

// ─── PREDICTION ───────────────────────────────────────────────────────────────

async function predict(featuresArray) {
  if (!model || !trained) {
    postMessage({ type: 'ERROR', payload: { message: 'Model not trained yet' } })
    return
  }

  const input    = tf.tensor2d([featuresArray])
  const output   = model.predict(input)
  const score    = (await output.data())[0]

  input.dispose()
  output.dispose()

  postMessage({ type: 'PREDICTION', payload: {
    score:      parseFloat(score.toFixed(4)),
    confidence: parseFloat((Math.abs(score - 0.5) * 2).toFixed(3)),
    retained:   score > 0.5,
    label:      score > 0.7 ? 'Strong retain' : score > 0.5 ? 'Likely retain' : score > 0.3 ? 'At risk' : 'Likely drop',
  }})
}

// ─── BATCH PREDICTION ─────────────────────────────────────────────────────────

async function predictBatch(featuresBatch) {
  if (!model || !trained) {
    postMessage({ type: 'ERROR', payload: { message: 'Model not trained yet' } })
    return
  }

  const input   = tf.tensor2d(featuresBatch)
  const output  = model.predict(input)
  const scores  = await output.data()

  input.dispose()
  output.dispose()

  const predictions = Array.from(scores).map((score, i) => ({
    index:      i,
    score:      parseFloat(score.toFixed(4)),
    retained:   score > 0.5,
    confidence: parseFloat((Math.abs(score - 0.5) * 2).toFixed(3)),
    label:      score > 0.7 ? 'Strong retain' : score > 0.5 ? 'Likely retain' : score > 0.3 ? 'At risk' : 'Likely drop',
  }))

  postMessage({ type: 'BATCH_PREDICTIONS', payload: { predictions } })
}

// ─── SAVE / LOAD WEIGHTS ──────────────────────────────────────────────────────

async function saveWeights() {
  if (!model || !trained) {
    postMessage({ type: 'ERROR', payload: { message: 'No trained model to save' } })
    return
  }
  const weights = model.getWeights().map(w => ({ data: w.arraySync(), shape: w.shape }))
  postMessage({ type: 'MODEL_SAVED', payload: { weights, savedAt: new Date().toISOString() } })
}

async function loadWeights(weightsData) {
  model   = buildModel()
  const tensors = weightsData.map(w => tf.tensor(w.data, w.shape))
  model.setWeights(tensors)
  tensors.forEach(t => t.dispose())
  trained = true
  postMessage({ type: 'MODEL_LOADED', payload: { loaded: true } })
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────

self.onmessage = async ({ data }) => {
  const { type, payload } = data
  switch (type) {
    case 'TRAIN':         await trainModel(payload.examples);        break
    case 'PREDICT':       await predict(payload.features);           break
    case 'PREDICT_BATCH': await predictBatch(payload.features);      break
    case 'SAVE':          await saveWeights();                       break
    case 'LOAD':          await loadWeights(payload.weights);        break
    default: console.warn('[retentionModel.worker] Unknown type:', type)
  }
}
