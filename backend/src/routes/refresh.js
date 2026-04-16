// backend/src/routes/refresh.js
const express  = require('express')
const { supabase } = require('../utils/supabase')
const { checkCategoryStaleness } = require('../services/smartScheduler')
const router   = express.Router()

router.get('/status', async (req, res) => {
  const { categoryId } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  // Verify category belongs to this user before exposing staleness data
  const { data: cat } = await supabase
    .from('categories')
    .select('id')
    .eq('id', categoryId)
    .eq('user_id', req.user.id)
    .single()

  if (!cat) return res.status(403).json({ error: 'Category not found' })

  const staleness = await checkCategoryStaleness(categoryId)
  res.json(staleness)
})

module.exports = router
