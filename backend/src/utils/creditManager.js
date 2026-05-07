// backend/src/utils/creditManager.js
// Core credit logic — check, deduct, refund, top-up, monthly reset
// Credits = internal token budget per user, separate from Anthropic balance

const { supabase } = require('./supabase')

// Cost in credits per action (1 credit = $0.10 of Anthropic spend budget)
// Prices rounded up generously so users aren't surprised
const CREDIT_COSTS = {
  generate_episode:    10,   // ~$0.20 actual, charge 10 credits ($1.00) — generous margin
  generate_hook:        2,   // hook variants only
  chat_message:         1,   // KB/KP chat — small
  vault_recommend:      2,   // vault recommendations
  series_bible:         5,   // one-off generation
  shorts_generate:      3,
  trending_refresh:     1,
}

// Monthly included credits by tier
const TIER_CREDITS = {
  free:   50,    // ~5 episodes worth — enough to trial
  studio: 500,   // ~50 episodes — plenty for active creators
}

// ── Get a user's current credit balance ──────────────────────────────────────
async function getBalance(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('credit_balance, credit_reset_at, tier')
    .eq('id', userId)
    .single()

  return {
    balance:    data?.credit_balance   ?? 0,
    resetAt:    data?.credit_reset_at  ?? null,
    tier:       data?.tier             ?? 'free',
    monthly:    TIER_CREDITS[data?.tier ?? 'free'],
  }
}

// ── Check if user can afford an action (without deducting) ──────────────────
async function canAfford(userId, action) {
  const cost = CREDIT_COSTS[action] ?? 1
  const { balance } = await getBalance(userId)
  return { allowed: balance >= cost, balance, cost, shortfall: Math.max(0, cost - balance) }
}

// ── Deduct credits for an action ─────────────────────────────────────────────
// Returns { success, newBalance, cost }
async function deduct(userId, action) {
  const cost = CREDIT_COSTS[action] ?? 1

  // Atomic decrement — fails if balance would go negative
  const { data, error } = await supabase.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount:  cost,
  })

  if (error || !data) {
    // RPC not yet available — fall back to read-then-write
    const { data: profile } = await supabase
      .from('profiles')
      .select('credit_balance')
      .eq('id', userId)
      .single()

    const current = profile?.credit_balance ?? 0
    if (current < cost) {
      return { success: false, balance: current, cost, shortfall: cost - current }
    }

    await supabase
      .from('profiles')
      .update({ credit_balance: current - cost, updated_at: new Date().toISOString() })
      .eq('id', userId)

    return { success: true, balance: current - cost, cost }
  }

  return { success: data >= 0, balance: data, cost }
}

// ── Refund credits (e.g. on generation failure) ──────────────────────────────
async function refund(userId, action) {
  const cost = CREDIT_COSTS[action] ?? 1
  await supabase
    .from('profiles')
    .update({
      credit_balance: supabase.rpc('increment', { row_id: userId, amount: cost }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .catch(() => {})

  // Simpler fallback
  const { data } = await supabase.from('profiles').select('credit_balance').eq('id', userId).single()
  const current = data?.credit_balance ?? 0
  await supabase.from('profiles').update({ credit_balance: current + cost }).eq('id', userId)
}

// ── Top up credits (admin or purchase) ───────────────────────────────────────
async function topUp(userId, amount, reason = 'purchase') {
  const { data: profile } = await supabase
    .from('profiles')
    .select('credit_balance')
    .eq('id', userId)
    .single()

  const current = profile?.credit_balance ?? 0
  const newBalance = current + amount

  await supabase
    .from('profiles')
    .update({ credit_balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', userId)

  // Log it
  await supabase.from('credit_transactions').insert({
    user_id:    userId,
    amount,
    type:       'topup',
    reason,
    balance_after: newBalance,
    created_at: new Date().toISOString(),
  }).catch(() => {})

  console.info(`[credits] Top-up: user=${userId} amount=${amount} reason=${reason} new_balance=${newBalance}`)
  return { newBalance }
}

// ── Monthly reset — give users their included credits back ───────────────────
// Called by smartScheduler on the 1st of each month
async function resetMonthlyCredits() {
  const { data: users } = await supabase
    .from('profiles')
    .select('id, tier, credit_balance')

  if (!users?.length) return

  const now = new Date().toISOString()
  let count = 0

  for (const user of users) {
    const monthly = TIER_CREDITS[user.tier ?? 'free']
    // Give monthly allocation — don't stack unused credits beyond 2× monthly
    const cap = monthly * 2
    const newBalance = Math.min((user.credit_balance ?? 0) + monthly, cap)

    await supabase
      .from('profiles')
      .update({ credit_balance: newBalance, credit_reset_at: now, updated_at: now })
      .eq('id', user.id)

    count++
  }

  console.info(`[credits] Monthly reset complete — ${count} users refreshed`)
}

module.exports = { getBalance, canAfford, deduct, refund, topUp, resetMonthlyCredits, CREDIT_COSTS, TIER_CREDITS }