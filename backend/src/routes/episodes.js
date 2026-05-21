// backend/src/routes/episodes.js
const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const { supabase }         = require('../utils/supabase');
const pushService          = require('../services/pushService');
const { assembleContext }  = require('../services/contextAssembler');
const tierGate             = require('../middleware/tier');
const creditGate           = require('../middleware/credits');
const { deduct, refund }   = require('../utils/creditManager');

const router = express.Router();
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── GENERATE EPISODE (SSE) ──────────────────────────────────────────────────

/**
 * POST /api/episodes/generate
 * Body: { categoryId, episodeNumber, trackContext, voiceMemoText, clipInventory }
 * Returns: SSE stream — progress → reasoning → chunks → done
 */
router.post('/generate', tierGate('generate_episode'), creditGate('generate_episode'), async (req, res) => {
  const {
    categoryId, episodeNumber: rawEpisodeNumber, trackContext,
    voiceMemoText, clipInventory = [],
  } = req.body;

  // Parse episodeNumber safely — empty string or missing becomes null,
  // then we auto-assign the next available number below
  const episodeNumber = rawEpisodeNumber !== '' && rawEpisodeNumber != null
    ? parseInt(rawEpisodeNumber, 10) || null
    : null;

  if (!categoryId || !trackContext?.name) {
    return res.status(400).json({ error: 'categoryId and trackContext.name are required' });
  }

  // Prevent concurrent generation of same episode number (race condition guard)
  const { data: inProgress } = await supabase
    .from('episodes')
    .select('id, status')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .eq('episode_number', episodeNumber)
    .eq('status', 'generating')
    .maybeSingle();

  if (inProgress) {
    return res.status(409).json({
      error: `Episode ${episodeNumber ?? 'unknown'} is already generating — wait for it to complete.`,
      episodeId: inProgress.id,
    });
  }

  // Auto-assign next episode number if not provided
  let resolvedEpisodeNumber = episodeNumber
  if (!resolvedEpisodeNumber) {
    const { data: latest } = await supabase
      .from('episodes')
      .select('episode_number')
      .eq('user_id', req.user.id)
      .eq('category_id', categoryId)
      .order('episode_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedEpisodeNumber = (latest?.episode_number ?? 0) + 1
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 15000)

  // Declare outside try so catch block can reference it
  let generationTimeout = null

  try {
    send('progress', { step: 'context', message: 'Loading your creative context...', pct: 5 });

    // Assemble full context
    const systemContext = await assembleContext(req.user.id, categoryId, {
      mode: 'generate',
      episodeCtx: { ...trackContext, episodeNumber: resolvedEpisodeNumber, voiceMemoText },
    });

    send('progress', { step: 'context', message: 'Context loaded', pct: 15 });

    // Build clip list string
    const clipList = clipInventory.length
      ? clipInventory.map(c => `${c.type.toUpperCase()}: ${c.filename}`).join('\n')
      : 'No clip inventory provided — use approximate timings';

    send('progress', { step: 'generating', message: 'Claude is structuring your episode...', pct: 20 });

    // Calculate target word count from episode duration
    const targetMinutes = trackContext.targetDurationMinutes || 8
    const targetWords   = Math.round(targetMinutes * 130)  // ~130 wpm natural speaking pace

    const userPrompt = `Generate a complete episode package.

EPISODE: ${resolvedEpisodeNumber}
TRACK: "${trackContext.name}"
MOOD: ${trackContext.mood || ''}
GENRE: ${trackContext.genre || ''}
BPM: ${trackContext.bpm || ''}
PLATFORM LINK: ${trackContext.platformLink || 'coming soon'}
TARGET DURATION: ${targetMinutes} minutes
TARGET VO WORD COUNT: approximately ${targetWords} words (${targetMinutes} min × 130 wpm natural pace)

FOOTAGE AVAILABLE:
${clipList}

VOICE MEMO:
"${voiceMemoText || 'No voice memo provided — use track context to infer the story'}"

THUMBNAIL CONCEPT:
${trackContext.thumbnailConcept || 'Not specified — infer the most compelling visual moment from the episode content for the THUMBNAIL_FLUX_PROMPT in metadata.'}

Return using these exact section markers:
===REASONING===
[Your structural thinking — 3-5 sentences]

===ENERGY_CURVE===
[Minute-by-minute energy/mood score 1-10 with one-line annotation per minute]

===VO_SCRIPT===
[Full timestamped voiceover script.
CRITICAL FORMATTING RULES:
- Write exactly ~${targetWords} words total (${targetMinutes} min at 130 wpm)
- Use SHORT paragraphs of 2-4 sentences maximum — each paragraph = one visual beat
- Leave a blank line between paragraphs — these are B-roll breathing points for the editor
- Begin each paragraph with [0:00] style timecode marker at natural speaking pace
- Do NOT write a wall of text — the editor needs visual cut points throughout
- Vary sentence length: punchy short sentences after longer build-up ones
- Write in the creator's natural voice as defined in the system context]

===EDL_CLIP_MAP===
[Ordered clip list: CLIP_01 | filename | IN: tc | OUT: tc | TRACK: V1/V2 | NOTE: ...]

===SHORTFORM_MOMENTS===
[2-3 short-form cuts: MOMENT_01 | clip | timecode | hook text | platform]

===METADATA===
YOUTUBE_TITLE:
YOUTUBE_DESCRIPTION:
YOUTUBE_TAGS:
YOUTUBE_CHAPTERS:
TIKTOK_CAPTION:
PLATFORM_CTA:
THUMBNAIL_FLUX_PROMPT: [Write a Flux image generation prompt for the thumbnail. Photorealistic, cinematic. Emotionally targeted to the audience pain point and aspiration from the context. No text overlays. End with: 16:9 aspect ratio, photorealistic, cinematic lighting]
THUMBNAIL_TITLE_OPTIONS:
[Option 1]
[Option 2]
[Option 3]`;

    // Stream with visible reasoning
    let fullResponse = '';
    let reasoningDone = false;

    // Hard cap: if generation hasn't finished in 3 minutes, close cleanly
    generationTimeout = setTimeout(() => {
      if (!res.writableEnded) {
        send('error', { message: 'Generation timed out after 3 minutes — try again' })
        res.end()
      }
    }, 3 * 60 * 1000)

    const stream = await client.messages.stream({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: parseInt(process.env.MAX_TOKENS) || 16000,
      system:     systemContext,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const text = chunk.delta.text;
        fullResponse += text;

        // Stream reasoning section separately for UI display
        if (!reasoningDone) {
          if (fullResponse.includes('===VO_SCRIPT===')) {
            reasoningDone = true;
            send('progress', { step: 'writing', message: 'Writing your VO script...', pct: 50 });
          } else if (fullResponse.includes('===REASONING===')) {
            send('reasoning', { text });
          }
        } else {
          send('chunk', { text });
        }
      }
    }

    // Token usage for cost tracking (~$0.003/1K input, $0.015/1K output for Sonnet)
    const usage = stream.finalMessage?.usage || {}
    const inputTokens  = usage.input_tokens  || 0
    const outputTokens = usage.output_tokens || 0
    const estimatedCostUsd = (inputTokens * 0.000003) + (outputTokens * 0.000015)

    // Log to token_usage_log table for admin cost tracking
    const { logTokens } = require('../utils/logTokens')
    logTokens({
      userId:       req.user.id,
      action:       'generate_episode',
      model:        process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      inputTokens,
      outputTokens,
    }).catch(() => {})

    send('progress', { step: 'saving', message: 'Saving episode package...', pct: 85, tokens: { inputTokens, outputTokens, estimatedCostUsd: parseFloat(estimatedCostUsd.toFixed(4)) } });

    // Parse output sections
    const extract = (tag) => {
      const regex = new RegExp(`===\\s*${tag}\\s*===\\s*([\\s\\S]*?)(?:===|$)`);
      const match = fullResponse.match(regex);
      return match ? match[1].trim() : null;
    };

    const parsed = {
      reasoning:      extract('REASONING'),
      energyCurve:    extract('ENERGY_CURVE'),
      voScript:       extract('VO_SCRIPT'),
      edlClipMap:     extract('EDL_CLIP_MAP'),
      shortformMoments: extract('SHORTFORM_MOMENTS'),
      metadata:       extract('METADATA'),
    };

    // Parse metadata block
    const metadataBlock = {};
    if (parsed.metadata) {
      parsed.metadata.split('\n').forEach(line => {
        const [key, ...val] = line.split(':');
        if (key && val.length) metadataBlock[key.trim()] = val.join(':').trim();
      });
    }

    // Save to Supabase
    const slug = trackContext.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .upsert({
        user_id:         req.user.id,
        category_id:     categoryId,
        episode_number:  resolvedEpisodeNumber,
        slug,
        status:          'ready',
        track_name:      trackContext.name,
        track_mood:      trackContext.mood,
        track_genre:     trackContext.genre,
        track_bpm:       trackContext.bpm,
        track_platform_link: trackContext.platformLink,
        voice_memo_text: voiceMemoText,
        vo_script:       parsed.voScript,
        edl_clip_map:    parsed.edlClipMap,
        metadata_block:  metadataBlock,
        short_form_moments: parsed.shortformMoments,
        retention_curve: parsed.energyCurve,
        generation_decisions: {
          reasoning:     parsed.reasoning,
          clipInventory,
          inputTokens,
          outputTokens,
          estimatedCostUsd,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,category_id,episode_number' })
      .select()
      .single();

    if (epError) throw new Error(`DB save failed: ${epError.message}`);

    // Auto-save hooks to vault
    if (parsed.voScript) {
      const firstLines = parsed.voScript.split('\n')
        .filter(l => l.trim() && !l.match(/^\[(?:CAM|DAW)/i))
        .slice(0, 3);

      for (const [i, line] of firstLines.entries()) {
        await supabase.from('vault_entries').insert({
          user_id:     req.user.id,
          category_id: categoryId,
          episode_id:  episode.id,
          type:        'hook',
          title:       `Hook ${String.fromCharCode(65+i)} — ${trackContext.name}`,
          content:     line,
          tags:        [trackContext.genre, trackContext.mood].filter(Boolean),
        });
      }
    }

    // Log generation decisions
    await supabase.from('generation_log').insert({
      user_id:      req.user.id,
      category_id:  categoryId,
      episode_id:   episode.id,
      episode_slug: slug,
      episode_number: resolvedEpisodeNumber,
      track_context: trackContext,
      decisions: {
        reasoning:    parsed.reasoning,
        hookType:     detectHookType(parsed.voScript),
        openingClip:  clipInventory[0]?.type || 'unknown',
      },
    });

    // Add to series memory
    await supabase.from('series_memory').upsert({
      user_id:       req.user.id,
      category_id:   categoryId,
      episode_id:    episode.id,
      episode_number: resolvedEpisodeNumber,
      episode_slug:  slug,
      track_name:    trackContext.name,
      track_context: trackContext,
    }, { onConflict: 'user_id,category_id,episode_number' });

    // Increment usage counter
    await supabase.rpc('increment_episodes_this_month', { p_user_id: req.user.id });

    send('progress', { step: 'complete', message: 'Episode package ready', pct: 100 });
    clearTimeout(generationTimeout)
    clearInterval(keepalive)

    // Deduct credits on successful generation
    if (req.creditAction) {
      const result = await deduct(req.user.id, req.creditAction)
      send('done', { episodeId: episode.id, slug, parsed, credits: { remaining: result.balance, used: result.cost } });
    } else {
      send('done', { episodeId: episode.id, slug, parsed });
    }
    res.end();

    // Push notification — episode ready
    setImmediate(async () => {
      try {
        const trackName = parsed?.metadata?.trackName || episode?.track_name || 'Your episode'
        const epNum     = parsed?.metadata?.episodeNumber || episode?.episode_number || '?'
        await pushService.sendToUser(
          req.user.id,
          pushService.episodeReadyPayload(trackName, epNum)
        )
      } catch {}
    })

    // Gemini script scoring — async, non-blocking, runs after response sent
    if (process.env.GEMINI_API_KEY && parsed?.voScript && episode?.id) {
      setImmediate(async () => {
        try {
          const { data: topEps } = await supabase
            .from('episodes')
            .select('track_name, yt_retention_score')
            .eq('user_id', req.user.id)
            .eq('category_id', req.body.categoryId)
            .eq('status', 'published')
            .not('yt_retention_score', 'is', null)
            .order('yt_retention_score', { ascending: false })
            .limit(5)

          const { data: cat } = await supabase
            .from('categories')
            .select('niche, trending_data')
            .eq('id', req.body.categoryId)
            .single()

          const score = await gemini.scoreScript(
            parsed.voScript,
            topEps || [],
            cat?.niche || '',
            cat?.trending_data?.analysis || null
          )

          if (score) {
            await supabase.from('episodes').update({
              script_score: score,
              updated_at:   new Date().toISOString(),
            }).eq('id', episode.id)
            console.log(`[gemini] Script scored ${score.overallScore}/100 for ep ${episode.id}`)
          }
        } catch (err) {
          console.warn('[gemini/scoring]', err.message)
        }
      })
    }

  } catch (err) {
    clearTimeout(generationTimeout)
    clearInterval(keepalive)
    console.error('[episodes/generate]', err.message);
    // Refund credits if generation failed after being gated
    if (req.creditAction) refund(req.user.id, req.creditAction).catch(() => {})
    send('error', { message: err.message });
    res.end();
  }
});

// ─── REGENERATE SINGLE SECTION ───────────────────────────────────────────────
// POST /api/episodes/:id/regenerate-section
// Body: { section: 'hook'|'vo_script'|'metadata'|'shortform'|'energy_curve' }
// Regenerates one section in isolation — ~10% of full generation cost.

router.post('/:id/regenerate-section', async (req, res) => {
  const { section } = req.body;
  const VALID = ['hook', 'vo_script', 'metadata', 'shortform', 'energy_curve'];
  if (!VALID.includes(section)) {
    return res.status(400).json({ error: `Invalid section. Must be one of: ${VALID.join(', ')}` });
  }

  const { data: episode, error: epErr } = await supabase
    .from('episodes')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (epErr || !episode) return res.status(404).json({ error: 'Episode not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const systemContext = await assembleContext(req.user.id, episode.category_id, { mode: 'generate' });

    const SECTION_PROMPTS = {
      hook: `Rewrite only the opening hook (first 2–3 sentences) of this episode's VO script.
The rest of the script will stay unchanged. Try a completely different hook strategy than before.
Current script opening: "${(episode.vo_script || '').split('\n').slice(0,4).join('\n')}"
Track: "${episode.track_name}" | Mood: ${episode.track_mood} | Genre: ${episode.track_genre}
Return ONLY the new hook sentences — no preamble, no section markers.`,

      vo_script: `Rewrite the full VO script for this episode.
Keep the same structure and EDL timecodes but refresh the language, vary sentence rhythm, and try a different hook.
Target: ~${Math.round((episode.generation_decisions?.trackContext?.targetDurationMinutes || 8) * 130)} words.
Track: "${episode.track_name}" | Mood: ${episode.track_mood}
Current script for reference:\n${episode.vo_script || '(none)'}
Return ONLY the new script starting from the first timecode — no preamble.`,

      metadata: `Rewrite the YouTube/TikTok metadata for this episode.
Generate a more clickable title, richer description with timestamps, better tags, and a stronger TikTok caption.
Track: "${episode.track_name}" | Mood: ${episode.track_mood} | Genre: ${episode.track_genre}
Current metadata:\n${episode.metadata_block ? JSON.stringify(episode.metadata_block, null, 2) : '(none)'}
Return ONLY the metadata block using these keys:
YOUTUBE_TITLE:
YOUTUBE_DESCRIPTION:
YOUTUBE_TAGS:
YOUTUBE_CHAPTERS:
TIKTOK_CAPTION:
PLATFORM_CTA:`,

      shortform: `Generate 3 new short-form cut suggestions for this episode.
Each should be a self-contained 45–60 second moment with a strong standalone hook.
Track: "${episode.track_name}" | VO Script excerpt:\n${(episode.vo_script || '').slice(0, 800)}
Return ONLY the shortform moments in this format:
MOMENT_01 | clip | timecode | hook text | platform`,

      energy_curve: `Rewrite the energy curve for this episode with more granular annotations.
Track: "${episode.track_name}" | Mood: ${episode.track_mood}
VO Script:\n${(episode.vo_script || '').slice(0, 1000)}
Return ONLY a minute-by-minute energy score (1–10) with a one-line annotation per minute.`,
    };

    let fullText = '';
    const stream = await client.messages.stream({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 2000,
      system:     systemContext,
      messages:   [{ role: 'user', content: SECTION_PROMPTS[section] }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        send('chunk', { text: chunk.delta.text });
      }
    }

    // Persist updated section back to the episode row
    const DB_FIELD = {
      hook:         null,  // hook updates the first lines of vo_script
      vo_script:    'vo_script',
      metadata:     null,  // parsed separately
      shortform:    'short_form_moments',
      energy_curve: 'retention_curve',
    };

    const updates = { updated_at: new Date().toISOString() };

    if (section === 'hook') {
      // Splice new hook into existing script — replace first non-timecode paragraph
      const lines  = (episode.vo_script || '').split('\n');
      const firstParaEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '');
      const rest   = firstParaEnd > 0 ? lines.slice(firstParaEnd).join('\n') : '';
      updates.vo_script = fullText.trim() + '\n' + rest;
    } else if (section === 'metadata') {
      const meta = {};
      fullText.split('\n').forEach(line => {
        const [k, ...v] = line.split(':');
        if (k && v.length) meta[k.trim()] = v.join(':').trim();
      });
      updates.metadata_block = meta;
    } else if (DB_FIELD[section]) {
      updates[DB_FIELD[section]] = fullText.trim();
    }

    await supabase.from('episodes').update(updates).eq('id', episode.id);

    send('done', { section, content: fullText.trim() });
    res.end();
  } catch (err) {
    send('error', { message: err.message });
    res.end();
  }
});

// ─── HOOK VARIANTS ────────────────────────────────────────────────────────────
// POST /api/episodes/hook-variants
// Body: { categoryId, trackContext, voiceMemoText }
// Returns 3 hook variants (different strategies) before full generation.
// Fast — single focused call, ~8 seconds.

router.post('/hook-variants', async (req, res) => {
  const { categoryId, trackContext, voiceMemoText } = req.body;
  if (!categoryId || !trackContext?.name) {
    return res.status(400).json({ error: 'categoryId and trackContext.name are required' });
  }

  try {
    const systemContext = await assembleContext(req.user.id, categoryId, { mode: 'generate' });

    const prompt = `Generate exactly 3 different opening hooks for this episode.
Each hook must use a completely different strategy. Be bold — don't play it safe.

Track: "${trackContext.name}"
Mood: ${trackContext.mood || 'not specified'}
Genre: ${trackContext.genre || 'not specified'}
BPM: ${trackContext.bpm || 'not specified'}
Voice memo: "${voiceMemoText || 'not provided'}"

Return ONLY valid JSON — no preamble, no markdown, no explanation:
{
  "variants": [
    {
      "strategy": "question",
      "label": "Open with a question",
      "hook": "2-3 sentence hook text here"
    },
    {
      "strategy": "in-media-res",
      "label": "Drop straight into the moment",
      "hook": "2-3 sentence hook text here"
    },
    {
      "strategy": "tension",
      "label": "Build tension from a fact or contradiction",
      "hook": "2-3 sentence hook text here"
    }
  ]
}`;

    const response = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 800,
      system:     systemContext,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    res.json({ variants: parsed.variants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DUPLICATE EPISODE ───────────────────────────────────────────────────────
// Clone an existing episode as a starting point — copies track context and
// voice memo into a new draft at the next episode number.

router.post('/:id/duplicate', async (req, res) => {
  const { data: source, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (error || !source) return res.status(404).json({ error: 'Episode not found' })

  // Find the highest episode number to auto-assign the next one
  const { data: latest } = await supabase
    .from('episodes')
    .select('episode_number')
    .eq('user_id', req.user.id)
    .eq('category_id', source.category_id)
    .order('episode_number', { ascending: false })
    .limit(1)
    .single()

  const nextNumber = (latest?.episode_number || source.episode_number) + 1
  const slug       = `${source.slug}-copy-${nextNumber}`

  const { data: clone, error: cloneError } = await supabase
    .from('episodes')
    .insert({
      user_id:          req.user.id,
      category_id:      source.category_id,
      episode_number:   nextNumber,
      slug,
      status:           'draft',
      track_name:       source.track_name     + ' (copy)',
      track_mood:       source.track_mood,
      track_genre:      source.track_genre,
      track_bpm:        source.track_bpm,
      track_platform_link: source.track_platform_link,
      voice_memo_text:  source.voice_memo_text,
    })
    .select()
    .single()

  if (cloneError) return res.status(500).json({ error: cloneError.message })
  res.status(201).json({ episode: clone })
})

// ─── USAGE STATS ─────────────────────────────────────────────────────────────
// Returns token cost totals for the current month — displayed in Settings

router.get('/usage', async (req, res) => {
  const now      = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data, error } = await supabase
    .from('episodes')
    .select('generation_decisions, created_at')
    .eq('user_id', req.user.id)
    .gte('created_at', monthStart)
    .not('generation_decisions', 'is', null)

  if (error) return res.status(500).json({ error: error.message })

  const episodes = data || []
  let totalInput  = 0
  let totalOutput = 0
  let totalCost   = 0

  for (const ep of episodes) {
    const d = ep.generation_decisions || {}
    totalInput  += d.inputTokens        || 0
    totalOutput += d.outputTokens       || 0
    totalCost   += d.estimatedCostUsd   || 0
  }

  res.json({
    episodesThisMonth: episodes.length,
    inputTokens:       totalInput,
    outputTokens:      totalOutput,
    estimatedCostUsd:  parseFloat(totalCost.toFixed(4)),
    monthStart,
  })
})

// ─── LIST EPISODES ───────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { categoryId, status, limit = 20, offset = 0 } = req.query;

  let query = supabase
    .from('episodes')
    .select('id, episode_number, slug, status, track_name, track_mood, track_genre, yt_retention_score, published_at, created_at')
    .eq('user_id', req.user.id)
    .order('episode_number', { ascending: false })
    .range(offset, offset + limit - 1);

  if (categoryId) query = query.eq('category_id', categoryId);
  if (status)     query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ episodes: data });
});

// ─── GET SINGLE EPISODE ───────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Episode not found' });
  res.json({ episode: data });
});

// ─── UPDATE EPISODE STATUS ────────────────────────────────────────────────────

router.patch('/:id/status', async (req, res) => {
  const { status, publishedAt } = req.body;

  const { data, error } = await supabase
    .from('episodes')
    .update({ status, published_at: publishedAt, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // When an episode is marked published:
  // 1. Regenerate series bible (always, non-blocking)
  // 2. Auto-generate if this is the 3rd, 5th, or 10th published episode — milestone moments
  if (status === 'published' && data?.category_id) {
    const { generateSeriesBible } = require('../services/seriesBible')

    // Count total published episodes for this category
    supabase
      .from('episodes')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', data.category_id)
      .eq('status', 'published')
      .then(({ count }) => {
        const milestone = [3, 5, 10, 20, 50].includes(count)
        console.log(`[seriesBible] Published count: ${count}${milestone ? ' — MILESTONE' : ''}`)

        // Always regenerate, force=true on milestone episodes
        generateSeriesBible(req.user.id, data.category_id, milestone)
          .then(bible => {
            console.log(`[seriesBible] Regenerated after Ep ${data.episode_number} published`)

            // Send push on milestone
            if (milestone) {
              pushService.sendToUser(req.user.id, {
                title: `📖 Series bible updated`,
                body:  `${count} episodes published — KB has updated your show bible with new insights`,
                icon:  '/icons/icon-192x192.png',
                tag:   'series-bible-updated',
                data:  { url: '/analytics', type: 'series_bible_updated' },
              }).catch(() => {})
            }
          })
          .catch(err => console.warn('[seriesBible] Auto-regen failed:', err.message))
      })
      .catch(() => {})

    pushService.sendToUser(req.user.id, {
      title: '🎉 Episode published',
      body:  `Ep ${data.episode_number} "${data.track_name}" is live`,
      icon:  '/icons/icon-192x192.png',
      tag:   'episode-published',
      data:  { url: `/episode/${data.id}`, type: 'episode_published' },
    }).catch(() => {})
  }

  res.json({ episode: data });
});

// ─── LOG PERFORMANCE ─────────────────────────────────────────────────────────

router.patch('/:id/performance', async (req, res) => {
  const { ytViewCount, ytAvgViewPct, ttViewCount, ttFullWatchRate } = req.body;

  const ytScore = ytAvgViewPct
    ? Math.round(ytAvgViewPct * 0.5 + Math.min(Math.log10(ytViewCount || 1) / 6, 1) * 50)
    : null;

  const { data, error } = await supabase
    .from('episodes')
    .update({
      yt_view_count:       ytViewCount,
      yt_avg_view_pct:     ytAvgViewPct,
      yt_retention_score:  ytScore,
      tt_view_count:       ttViewCount,
      tt_full_watch_rate:  ttFullWatchRate,
      performance_logged_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Also update series memory and generation log
  await supabase.from('series_memory')
    .update({ performance: { ytScore, ytViewCount, ttViewCount } })
    .eq('episode_id', req.params.id);

  await supabase.from('generation_log')
    .update({ performance: { ytScore, ytViewCount, ttViewCount }, performance_logged_at: new Date().toISOString() })
    .eq('episode_id', req.params.id);

  res.json({ episode: data });
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function detectHookType(voScript) {
  if (!voScript) return 'unknown';
  const firstLine = voScript.split('\n').find(l => l.trim() && !l.match(/^\[/)) || '';
  if (firstLine.includes('?')) return 'question';
  if (firstLine.match(/^I /i)) return 'personal';
  if (firstLine.match(/^(There|It|That|This)/i)) return 'scene-setting';
  return 'in-media-res';
}


// ─── PATCH /episodes/:id — general field update (pipeline_stage etc.) ─────────
router.patch('/:id', async (req, res) => {
  const ALLOWED = ['pipeline_stage', 'status', 'title', 'track_name', 'vo_script', 'youtube_video_id', 'tiktok_video_id', 'description', 'tags']
  const updates = {}
  ALLOWED.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields' })
  updates.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('episodes')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ episode: data })
})

module.exports = router;