// backend/src/middleware/credits.js
// Checks credit balance before allowing an action
// Usage: router.post('/generate', authMiddleware, creditGate('generate_episode'), handler)

const { canAfford } = require('../utils/creditManager')

function creditGate(action) {
  return async (req, res, next) => {
    try {
      const { allowed, balance, cost, shortfall } = await canAfford(req.user.id, action)

      if (!allowed) {
        return res.status(402).json({
          error: `Not enough credits. This action costs ${cost} credits but you only have ${balance}.`,
          credits_required: true,
          cost,
          balance,
          shortfall,
          action,
        })
      }

      // Attach to request so the handler can deduct after success
      req.creditAction = action
      req.creditCost   = cost
      next()
    } catch (err) {
      // Fail open — don't block on credit check errors
      console.error('[creditGate] Error checking credits:', err.message)
      next()
    }
  }
}

module.exports = creditGate