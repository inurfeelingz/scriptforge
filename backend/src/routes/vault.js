// backend/src/routes/vault.js
const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const { supabase }        = require('../utils/supabase');
const { assembleContext } = require('../services/contextAssembler');

const router = express.Router();
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── LIST / SEARCH ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { categoryId, type, favourite, unused, search, tags, limit = 50, offset = 0 } = req.query;

  let query = supabase
    .from('vault_entries')
    .select('id, type, title, content, tags, is_favourite, used_at, performance, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (categoryId)         query = query.eq('category_id', categoryId);
  if (type)               query = query.eq('type', type);
  if (favourite === 'true') query = query.eq('is_favourite', true);
  if (unused === 'true')  query = query.is('used_at', null);
  if (search)             query = query.textSearch('search_vector', search, { type: 'websearch' });
  if (tags) {
    const tagArray = tags.split(',').map(t => t.trim());
    query = query.overlaps('tags', tagArray);
  }

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entries: data, count });
});

// ─── CREATE ───────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { categoryId, episodeId, type, title, content, tags = [] } = req.body;

  if (!type || !title || !content) {
    return res.status(400).json({ error: 'type, title, and content are required' });
  }

  const { data, error } = await supabase
    .from('vault_entries')
    .insert({
      user_id:     req.user.id,
      category_id: categoryId,
      episode_id:  episodeId,
      type, title, content, tags,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ entry: data });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  const { title, content, tags, isFavourite, usedAt, performance } = req.body;

  const updates = {};
  if (title       !== undefined) updates.title        = title;
  if (content     !== undefined) updates.content      = content;
  if (tags        !== undefined) updates.tags         = tags;
  if (isFavourite !== undefined) updates.is_favourite = isFavourite;
  if (usedAt      !== undefined) updates.used_at      = usedAt;
  if (performance !== undefined) {
    updates.performance = performance;
    updates.type        = 'successful'; // promote
  }

  const { data, error } = await supabase
    .from('vault_entries')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data });
});

// ─── TOGGLE FAVOURITE ─────────────────────────────────────────────────────────

router.post('/:id/favourite', async (req, res) => {
  const { data: current } = await supabase
    .from('vault_entries')
    .select('is_favourite')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!current) return res.status(404).json({ error: 'Entry not found' });

  const { data, error } = await supabase
    .from('vault_entries')
    .update({ is_favourite: !current.is_favourite, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('vault_entries')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
});

// ─── WEEKLY RECOMMENDATIONS (Claude-powered) ──────────────────────────────────

router.get('/recommendations', async (req, res) => {
  const { categoryId } = req.query;
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' });

  // Get unused favourites + high-potential entries
  const { data: candidates } = await supabase
    .from('vault_entries')
    .select('id, type, title, content, tags, performance')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!candidates?.length) {
    return res.json({ recommendations: [], message: 'No unused vault entries yet' });
  }

  const context = await assembleContext(req.user.id, categoryId, { mode: 'vault' });

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 800,
    system:     context,
    messages: [{
      role: 'user',
      content: `From these ${candidates.length} unused vault entries, identify the 5 strongest ideas for this week based on current trends, the creator's niche, and past performance patterns.

VAULT ENTRIES:
${candidates.map((e, i) => `${i+1}. [${e.type}] "${e.title}": ${e.content.slice(0, 120)}`).join('\n')}

Return JSON array of 5 objects: { id, title, reason, urgency: "high/medium/low" }
Reason should be 1 sentence. Be specific — reference the trend or pattern driving the recommendation.`,
    }],
  });

  try {
    const text  = response.content[0].text.replace(/```json|```/g, '').trim();
    const recs  = JSON.parse(text);
    res.json({ recommendations: recs });
  } catch {
    res.json({ recommendations: [], raw: response.content[0].text });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const { categoryId } = req.query;

  const { data } = await supabase
    .from('vault_entries')
    .select('type, is_favourite, used_at')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId);

  if (!data) return res.json({ total: 0 });

  const stats = {
    total:      data.length,
    favourites: data.filter(e => e.is_favourite).length,
    unused:     data.filter(e => !e.used_at).length,
    byType:     data.reduce((acc, e) => { acc[e.type] = (acc[e.type]||0)+1; return acc; }, {}),
  };

  res.json(stats);
});

module.exports = router;
