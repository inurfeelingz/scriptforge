// backend/src/middleware/tier.js
// Usage: router.post('/generate', authMiddleware, tierGate('generate_episode'), handler)

const { supabase } = require('../utils/supabase');

function tierGate(action) {
  return async (req, res, next) => {
    const { data, error } = await supabase
      .rpc('check_tier_limit', { p_user_id: req.user.id, p_action: action });

    if (error) return next(); // fail open on DB error

    if (!data?.allowed) {
      return res.status(403).json({
        error: data?.reason || 'Feature not available on your current plan',
        upgrade_required: true,
        action,
      });
    }

    next();
  };
}

module.exports = tierGate;
