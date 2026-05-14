// backend/src/routes/categories.js
const express = require('express');
const { supabase }               = require('../utils/supabase');
const { checkCategoryStaleness, triggerRefresh } = require('../services/smartScheduler');
const tierGate                   = require('../middleware/tier');
const { invalidateContext }       = require('../services/contextAssembler');

const router = express.Router();

// ─── LIST ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    // FIX: added onboarded_at and voice_profile to the select.
    // These were missing, so cat.onboarded_at was always undefined in the store,
    // causing KBHome to treat every user as needing onboarding on every page load —
    // the root cause of the onboarding loop bug.
    .select('id, name, niche, color, icon, total_episodes, avg_retention, trending_refreshed_at, is_active, created_at, onboarded_at, voice_profile')
    .eq('user_id', req.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ categories: data });
});

// ─── CREATE ───────────────────────────────────────────────────────────────────

router.post('/', tierGate('create_category'), async (req, res) => {
  const { name, niche, description, color, icon } = req.body;

  if (!name?.trim() || !niche?.trim()) {
    return res.status(400).json({ error: 'name and niche are required' });
  }

  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id:     req.user.id,
      name:        name.trim(),
      niche:       niche.trim(),
      description: description?.trim(),
      color:       color || '#6366f1',
      icon:        icon  || 'film',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Trigger initial trending fetch for new category
  triggerRefresh(req.user.id, data.id, 'manual').catch(console.warn);

  res.status(201).json({ category: data });
});

// ─── GET SINGLE + STALENESS CHECK ────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Category not found' });

  // Check staleness — client can use this to show a refresh indicator
  const staleness = await checkCategoryStaleness(req.params.id);

  res.json({ category: data, staleness });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  const { name, niche, description, color, icon, refreshIntervalHours, autoRefreshEnabled, voice_profile } = req.body;

  const updates = {};
  if (name  !== undefined) updates.name                  = name;
  if (niche !== undefined) updates.niche                 = niche;
  if (description !== undefined) updates.description     = description;
  if (color !== undefined) updates.color                 = color;
  if (icon  !== undefined) updates.icon                  = icon;
  if (refreshIntervalHours !== undefined) updates.refresh_interval_hours = refreshIntervalHours;
  if (autoRefreshEnabled   !== undefined) updates.auto_refresh_enabled   = autoRefreshEnabled;
  if (voice_profile        !== undefined) updates.voice_profile           = voice_profile;

  const { data, error } = await supabase
    .from('categories')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  invalidateContext(req.user.id, req.params.id);
  res.json({ category: data });
});

// ─── SWITCH CATEGORY (triggers staleness check + auto-refresh) ───────────────

router.post('/:id/switch', async (req, res) => {
  const staleness = await checkCategoryStaleness(req.params.id);

  // If stale, trigger background refresh (don't await — return immediately)
  if (staleness.stale) {
    triggerRefresh(req.user.id, req.params.id, 'category_switch')
      .catch(err => console.warn('[categories/switch] Refresh failed:', err.message));
  }

  res.json({
    categoryId:  req.params.id,
    stale:       staleness.stale,
    hoursOld:    staleness.hoursOld,
    refreshing:  staleness.stale,
    message:     staleness.stale
      ? `Trending data was ${staleness.hoursOld}h old — refreshing in background`
      : 'Trending data is current',
  });
});

// ─── MANUAL REFRESH ───────────────────────────────────────────────────────────

router.post('/:id/refresh', async (req, res) => {
  const result = await triggerRefresh(req.user.id, req.params.id, 'manual');
  res.json(result);
});

// ─── DELETE (soft) ────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('categories')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
});

module.exports = router;