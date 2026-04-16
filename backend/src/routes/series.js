// backend/src/routes/series.js
const express  = require('express');
const { supabase } = require('../utils/supabase');
const router   = express.Router();

router.get('/', async (req, res) => {
  const { categoryId } = req.query;
  const { data, error } = await supabase
    .from('series_memory')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ series: data || [] });
});

router.patch('/:id', async (req, res) => {
  const { publishedAt, performance } = req.body;
  const updates = {};
  if (publishedAt  !== undefined) updates.published_at = publishedAt;
  if (performance  !== undefined) updates.performance  = performance;
  const { data, error } = await supabase
    .from('series_memory')
    .update({ ...updates })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data });
});

module.exports = router;
