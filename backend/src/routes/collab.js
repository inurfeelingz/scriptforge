// backend/src/routes/collab.js
const express  = require('express');
const { supabase } = require('../utils/supabase');
const tierGate = require('../middleware/tier');
const router   = express.Router();

// Create session
router.post('/session', tierGate('collab'), async (req, res) => {
  const { categoryId, episodeId } = req.body;
  const { data, error } = await supabase
    .from('collab_sessions')
    .insert({
      owner_id:    req.user.id,
      category_id: categoryId,
      episode_id:  episodeId,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ session: data });
});

// Join session by code
router.post('/join/:code', async (req, res) => {
  const { data: session, error } = await supabase
    .from('collab_sessions')
    .select('*')
    .eq('session_code', req.params.code)
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !session) return res.status(404).json({ error: 'Session not found or expired' });

  const participants = session.participants || [];
  const alreadyIn    = participants.some(p => p.user_id === req.user.id);
  const MAX_PARTICIPANTS = 5;

  if (!alreadyIn && participants.length >= MAX_PARTICIPANTS) {
    return res.status(403).json({ error: `Session is full (max ${MAX_PARTICIPANTS} participants)` });
  }

  if (!alreadyIn) {
    const updated = [
      ...participants,
      { user_id: req.user.id, role: 'collaborator', joined_at: new Date().toISOString() }
    ];
    await supabase.from('collab_sessions')
      .update({ participants: updated })
      .eq('id', session.id);
  }

  res.json({ session, joined: !alreadyIn });
});

// Get active session
router.get('/session/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('collab_sessions')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Session not found' });
  res.json({ session: data });
});

// End session
router.delete('/session/:id', async (req, res) => {
  await supabase.from('collab_sessions')
    .update({ is_active: false })
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id);
  res.json({ ended: true });
});

module.exports = router;
