// backend/src/routes/public.js
// Public routes — no auth required.
// /api/public/profile/:username — returns creator profile + published episodes + series bible

const express    = require('express')
const router     = express.Router()
const { supabase } = require('../utils/supabase')

// GET /api/public/profile/:username
router.get('/profile/:username', async (req, res) => {
  const { username } = req.params
  if (!username?.trim()) return res.status(400).json({ error: 'username required' })

  try {
    // Find profile by display_name or email prefix
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email, tier')
      .or(`display_name.ilike.${username},email.ilike.${username}%`)
      .limit(1)

    const profile = profiles?.[0]
    if (!profile) return res.status(404).json({ error: 'Profile not found' })

    // Get their most active category (highest episode count)
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, niche, series_bible')
      .eq('user_id', profile.id)
      .eq('is_active', true)
      .limit(1)

    const cat = categories?.[0]

    // Get published episodes
    const { data: episodes } = await supabase
      .from('episodes')
      .select('id, episode_number, track_name, published_at, youtube_video_id, yt_retention_score')
      .eq('user_id', profile.id)
      .eq('status', 'published')
      .order('episode_number', { ascending: false })
      .limit(20)

    // Build public profile — strip sensitive data
    res.json({
      profile: {
        display_name: profile.display_name,
        niche:        cat?.niche || null,
        tier:         profile.tier,
      },
      episodes:    episodes || [],
      seriesBible: cat?.series_bible || null,
    })
  } catch (err) {
    console.error('[public/profile]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router