// backend/src/utils/logTokens.js
// Log token usage after every Claude API call
// Prices as of 2024: claude-sonnet input $3/M, output $15/M

const { supabase } = require('./supabase')

// Cost per million tokens in USD
const PRICE = {
  'claude-sonnet-4-5':           { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-20250514':    { input: 3.00,  output: 15.00 },
  'claude-opus-4-5':             { input: 15.00, output: 75.00 },
  'claude-haiku-4-5-20251001':   { input: 0.25,  output: 1.25  },
}

function calcCost(model, inputTokens, outputTokens) {
  const p = PRICE[model] || PRICE['claude-sonnet-4-20250514']
  return ((inputTokens * p.input) + (outputTokens * p.output)) / 1_000_000
}

async function logTokens({ userId, action, model, inputTokens, outputTokens }) {
  try {
    const cost = calcCost(model, inputTokens, outputTokens)
    await supabase.from('token_usage_log').insert({
      user_id:       userId,
      action,
      model:         model || 'unknown',
      input_tokens:  inputTokens  || 0,
      output_tokens: outputTokens || 0,
      cost_usd:      cost,
      created_at:    new Date().toISOString(),
    })
    console.info(`[tokens] ${action} — in:${inputTokens} out:${outputTokens} $${cost.toFixed(4)}`)
    
    // Low balance check — warn in logs if daily spend is high
    const today = new Date().toISOString().slice(0, 10)
    const { data: todayRows } = await supabase
      .from('token_usage_log')
      .select('cost_usd')
      .gte('created_at', `${today}T00:00:00Z`)
    
    const todaySpend = (todayRows || []).reduce((s, r) => s + parseFloat(r.cost_usd || 0), 0)
    if (todaySpend > 5) {
      console.warn(`[tokens] ⚠️  Today's spend: $${todaySpend.toFixed(2)} — check Anthropic balance`)
    }
  } catch (err) {
    // Non-critical — never block generation
    console.warn('[tokens] Log failed:', err.message)
  }
}

module.exports = { logTokens, calcCost }
