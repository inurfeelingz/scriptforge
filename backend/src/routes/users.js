// backend/src/routes/users.js
const express  = require('express');
const { supabase } = require('../utils/supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Public: check invite code
router.get('/invite/:code', async (req, res) => {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('code, tier, expires_at, use_count, max_uses')
    .eq('code', req.params.code)
    .single();

  if (error || !data) return res.status(404).json({ valid: false });
  const valid = data.use_count < data.max_uses && new Date(data.expires_at) > new Date();
  res.json({ valid, tier: data.tier });
});

// Called after signup to redeem an invite code (increments use_count, sets tier)
router.post('/invite/:code/redeem', authMiddleware, async (req, res) => {
  const { data: invite, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('code', req.params.code)
    .single()

  if (error || !invite) return res.status(404).json({ error: 'Invite code not found' })
  if (invite.use_count >= invite.max_uses) return res.status(400).json({ error: 'Invite code already used' })
  if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'Invite code expired' })

  // Atomically increment use_count
  await supabase
    .from('invite_codes')
    .update({ use_count: invite.use_count + 1, used_by: req.user.id })
    .eq('id', invite.id)
    .eq('use_count', invite.use_count)  // optimistic lock

  // Upgrade user's tier
  await supabase
    .from('profiles')
    .update({
      tier:           invite.tier,
      max_episodes_pm: invite.tier === 'studio' ? 9999 : invite.tier === 'pro' ? 30 : 8,
      max_categories:  invite.tier === 'studio' ? 9999 : invite.tier === 'pro' ? 10 : 3,
      invited_by:     invite.created_by,
    })
    .eq('id', req.user.id)

  res.json({ redeemed: true, tier: invite.tier })
})

// Protected: get own profile
router.get('/profile', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ profile: data });
});

// Protected: update profile
router.patch('/profile', authMiddleware, async (req, res) => {
  const { displayName, avatarUrl } = req.body;
  const updates = {};
  if (displayName !== undefined) updates.display_name = displayName;
  if (avatarUrl   !== undefined) updates.avatar_url   = avatarUrl;

  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ profile: data });
});

// Admin: list all users
router.get('/', authMiddleware, async (req, res) => {
  if (!req.profile?.is_admin) return res.status(403).json({ error: 'Admin only' });

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, tier, created_at, episodes_this_month, total_episodes')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data });
});

// Admin: create invite code
router.post('/invite', authMiddleware, async (req, res) => {
  if (!req.profile?.is_admin) return res.status(403).json({ error: 'Admin only' });
  const { tier = 'pro', maxUses = 1, expiresInDays = 30 } = req.body;

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invite_codes')
    .insert({ created_by: req.user.id, tier, max_uses: maxUses, expires_at: expiresAt })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ invite: data });
});

module.exports = router;
