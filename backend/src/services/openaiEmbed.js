// backend/src/services/openaiEmbed.js
// OpenAI text embeddings for semantic matching.
// Uses text-embedding-3-small with dimensions=384 so vectors are directly
// comparable to the MiniLM text_vector column in clip_index.

const axios = require('axios')

const MODEL      = 'text-embedding-3-small'
const DIMENSIONS = 384  // matches MiniLM dim — no schema migration needed

async function embed(text) {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: zero vector (text matching will handle it)
    return new Array(DIMENSIONS).fill(0)
  }

  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: MODEL, input: text.slice(0, 8000), dimensions: DIMENSIONS },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
  )

  return response.data.data[0].embedding
}

async function embedBatch(texts) {
  if (!process.env.OPENAI_API_KEY) {
    return texts.map(() => new Array(DIMENSIONS).fill(0))
  }

  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: MODEL, input: texts.map(t => t.slice(0, 8000)), dimensions: DIMENSIONS },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
  )

  // Sort by index to maintain order
  return response.data.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}

module.exports = { embed, embedBatch }
