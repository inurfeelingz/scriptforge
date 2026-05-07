// backend/src/middleware/tier.js
// Single tier system: free | studio (pro treated as studio for backwards compat)
// Only gates: episode count limit and category count limit
// All features available to paid users — no feature-based gating

const { supabase } = require('../utils/supabase');

function tierGate(action) {
  return async (req, res, next) => {
    // Feature gates — all pass for paid users, collab still requires studio
    const featureOnly = ['collab']
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, episodes_this_month, max_episodes_pm, max_categories')
      .eq('id', req.user.id)
      .single()

    if (!profile) return next() // fail open

    // Normalise: treat 'pro' as 'studio' for backwards compat
    const tier = profile.tier === 'pro' ? 'studio' : (profile.tier || 'free')
    const isPaid = tier === 'studio'

    // Collab requires paid plan
    if (action === 'collab' && !isPaid) {
      return res.status(403).json({
        error: 'Collaboration requires a Studio subscription',
        upgrade_required: true,
        action,
      })
    }

    // Episode generation — check monthly limit
    if (action === 'generate_episode') {
      const used = profile.episodes_this_month || 0
      const max  = profile.max_episodes_pm || (isPaid ? 99999 : 3)
      if (used >= max) {
        return res.status(403).json({
          error: isPaid
            ? `Monthly episode limit reached (${max}). Contact support.`
            : `Free plan limit reached (${max} episodes/month). Upgrade to Studio for unlimited.`,
          upgrade_required: !isPaid,
          action,
          used,
          max,
        })
      }
    }

    // Category creation — check limit
    if (action === 'create_category') {
      const { count } = await supabase
        .from('categories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
      
      const max = profile.max_categories || (isPaid ? 99 : 1)
      if ((count || 0) >= max) {
        return res.status(403).json({
          error: isPaid
            ? `Workspace limit reached (${max}). Contact support.`
            : `Free plan allows ${max} workspace. Upgrade to Studio for unlimited.`,
          upgrade_required: !isPaid,
          action,
        })
      }
    }

    next()
  }
}

module.exports = tierGate