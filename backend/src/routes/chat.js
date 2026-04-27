// backend/src/routes/chat.js
// Streaming Claude chat endpoint — works across all modes.
// Injects full assembled context before every message.

const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { assembleContext } = require('../services/contextAssembler');
const { supabase }        = require('../utils/supabase');

const router = express.Router();
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Per-session context cache ────────────────────────────────────────────────
// assembleContext fires 8 DB queries. In a long chat session the context doesn't
// change between messages — cache it per user+category+mode for 90 seconds.
const ctxCache = new Map()
const CTX_TTL  = 90 * 1000  // 90 seconds

function getCachedCtx(userId, categoryId, mode) {
  const key   = `${userId}:${categoryId}:${mode}`
  const entry = ctxCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CTX_TTL) { ctxCache.delete(key); return null }
  return entry.value
}

function setCachedCtx(userId, categoryId, mode, value) {
  const key = `${userId}:${categoryId}:${mode}`
  ctxCache.set(key, { value, ts: Date.now() })
  if (ctxCache.size > 50) {  // evict oldest
    const oldest = [...ctxCache.entries()].sort((a,b) => a[1].ts - b[1].ts)[0]
    ctxCache.delete(oldest[0])
  }
}

/**
 * POST /api/chat/message
 * Body: { categoryId, mode, message, episodeCtx?, chatHistory? }
 * Returns: SSE stream of Claude response chunks
 */
router.post('/message', async (req, res) => {
  const { categoryId, mode = 'generate', message, episodeCtx, messages = [] } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Assemble context — cached per session to avoid 8 DB queries per message
    // Cache is busted when categories update (invalidateContext) or after 90s
    const cacheKey = episodeCtx ? null : `${req.user.id}:${categoryId}:${mode}`
    let systemContext = cacheKey ? getCachedCtx(req.user.id, categoryId, mode) : null

    if (!systemContext) {
      systemContext = await assembleContext(req.user.id, categoryId, {
        mode,
        episodeCtx,
        chatHistory: messages.length > 6
          ? `[${messages.length} prior messages — continuing conversation]`
          : null,
      })
      if (cacheKey) setCachedCtx(req.user.id, categoryId, mode, systemContext)
    }

    // Build conversation history for Claude
    // Keep last 10 messages to manage context window
    const recentMessages = messages.slice(-10);
    const claudeMessages = [
      ...recentMessages,
      { role: 'user', content: message },
    ];

    // Stream Claude response
    let fullResponse = '';

    const stream = await client.messages.stream({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 2000,
      system:     systemContext,
      messages:   claudeMessages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const text = chunk.delta.text;
        fullResponse += text;
        send('chunk', { text });
      }
    }

    // Persist chat history to Supabase
    if (categoryId) {
      const updatedMessages = [
        ...recentMessages,
        { role: 'user',      content: message,      timestamp: new Date().toISOString() },
        { role: 'assistant', content: fullResponse,  timestamp: new Date().toISOString() },
      ];

      await supabase
        .from('chat_history')
        .upsert({
          user_id:     req.user.id,
          category_id: categoryId,
          mode,
          messages:    updatedMessages,
          updated_at:  new Date().toISOString(),
        }, { onConflict: 'user_id,mode,category_id' });
    }

    send('done', { response: fullResponse });
    res.end();

  } catch (err) {
    console.error('[chat] Error:', err.message);
    send('error', { message: err.message });
    res.end();
  }
});

/**
 * GET /api/chat/history?categoryId=&mode=
 * Returns chat history for a mode
 */
router.get('/history', async (req, res) => {
  const { categoryId, mode = 'generate' } = req.query;

  const { data } = await supabase
    .from('chat_history')
    .select('messages, updated_at')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .eq('mode', mode)
    .single();

  res.json({ messages: data?.messages || [], updatedAt: data?.updated_at });
});

/**
 * DELETE /api/chat/history
 * Clear chat history for a mode
 */
router.delete('/history', async (req, res) => {
  const { categoryId, mode } = req.body;

  await supabase
    .from('chat_history')
    .delete()
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .eq('mode', mode);

  res.json({ cleared: true });
});

module.exports = router;
