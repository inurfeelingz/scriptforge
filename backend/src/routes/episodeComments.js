// backend/src/routes/episodeComments.js
// Collaboration notes on episodes — lightweight threaded comments.
// Used by collaborators who join via session code, and by the creator themselves.

const express    = require('express')
const router     = express.Router()
const { supabase } = require('../utils/supabase')
const auth       = require('../middleware/auth')

router.use(auth)

// GET /api/episode-comments/:episodeId — list comments
router.get('/:episodeId', async (req, res) => {
  const { data, error } = await supabase
    .from('episode_comments')
    .select('id, content, author_name, created_at, parent_id, resolved')
    .eq('episode_id', req.params.episodeId)
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ comments: data || [] })
})

// POST /api/episode-comments/:episodeId — add a comment
router.post('/:episodeId', async (req, res) => {
  const { content, parentId, authorName } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' })

  const { data, error } = await supabase
    .from('episode_comments')
    .insert({
      episode_id:  req.params.episodeId,
      user_id:     req.user.id,
      content:     content.trim(),
      parent_id:   parentId || null,
      author_name: authorName || 'Creator',
      created_at:  new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ comment: data })
})

// PATCH /api/episode-comments/:id/resolve — toggle resolved
router.patch('/:id/resolve', async (req, res) => {
  const { data: existing } = await supabase
    .from('episode_comments')
    .select('resolved')
    .eq('id', req.params.id)
    .single()

  const { data, error } = await supabase
    .from('episode_comments')
    .update({ resolved: !existing?.resolved })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ comment: data })
})

// DELETE /api/episode-comments/:id
router.delete('/:id', async (req, res) => {
  await supabase
    .from('episode_comments')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ deleted: true })
})

module.exports = router