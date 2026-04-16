// backend/src/services/contextAssembler.js
// Builds the persistent Claude system context for a user + category.

// ── In-memory TTL cache ───────────────────────────────────────────────────────
// 8 parallel DB queries per Claude interaction adds up fast.
// Cache assembled context for 60s per user+category+mode combo.
// Invalidated by category switch or explicit context refresh.
const contextCache = new Map()
const CACHE_TTL_MS = 60 * 1000  // 60 seconds

function getCached(key) {
  const entry = contextCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) { contextCache.delete(key); return null }
  return entry.value
}

function setCached(key, value) {
  contextCache.set(key, { value, ts: Date.now() })
  // Prevent unbounded growth — evict oldest entries if cache > 100 entries
  if (contextCache.size > 100) {
    const oldest = [...contextCache.entries()].sort((a,b) => a[1].ts - b[1].ts)[0]
    contextCache.delete(oldest[0])
  }
}

/** Call this when a category is updated or switched to bust the cache */
function invalidateContext(userId, categoryId) {
  for (const key of contextCache.keys()) {
    if (key.startsWith(`${userId}:${categoryId}`)) contextCache.delete(key)
  }
}
// Called before every Claude interaction across all modes.
// Weights context by relevance — most impactful data front-loaded.

const { supabase } = require('../utils/supabase');

/**
 * Assemble the full Claude system context for a user + category.
 * Returns a string ready to use as the system prompt prefix.
 *
 * @param {string} userId
 * @param {string} categoryId
 * @param {object} options
 * @param {string} options.mode        — 'generate' | 'vault' | 'series' | 'analytics' | 'sound' | 'teleprompter'
 * @param {object} options.episodeCtx  — current episode being worked on (optional)
 * @param {string} options.chatHistory — compressed prior conversation (optional)
 */
async function assembleContext(userId, categoryId, options = {}) {
  const { mode = 'generate', episodeCtx, chatHistory } = options;

  // Skip cache for generation (episode context changes) — cache chat/vault/series
  const cacheable = !episodeCtx && mode !== 'generate'
  const cacheKey  = `${userId}:${categoryId}:${mode}`
  if (cacheable) {
    const cached = getCached(cacheKey)
    if (cached) return cached
  }

  // Fetch all data sources in parallel
  const [
    category,
    recentEpisodes,
    topPerformers,
    latestAnalytics,
    seriesMemory,
    logInsights,
    trendingData,
    vaultHighlights,
  ] = await Promise.all([
    getCategory(userId, categoryId),
    getRecentEpisodes(userId, categoryId, 5),
    getTopPerformers(userId, categoryId, 3),
    getLatestAnalytics(userId, categoryId),
    getSeriesMemory(userId, categoryId, 8),
    getLogInsights(userId, categoryId),
    getTrendingData(categoryId),
    getVaultHighlights(userId, categoryId),
  ]);

  if (!category) return buildMinimalContext(mode);

  const sections = [];

  // ── IDENTITY ──────────────────────────────────────────────
  sections.push(`# SCRIPTFORGE CONTEXT
You are the AI creative layer inside ScriptForge, a content production system for a solo creator.
Current mode: ${mode.toUpperCase()}
Creator niche: ${category.niche}
Category: ${category.name}${episodeCtx?.targetDurationMinutes ? `
Target episode duration: ${episodeCtx.targetDurationMinutes} minutes (~${Math.round(episodeCtx.targetDurationMinutes * 130)} words VO)` : ''}`);

  // ── VOICE PROFILE ─────────────────────────────────────────
  if (category.voice_profile) {
    const vp = category.voice_profile;
    const vc = vp.voiceCharacteristics || {};
    const sp = vp.structuralPatterns || {};
    const lf = vp.languageFingerprint || {};

    sections.push(`## CREATOR VOICE PROFILE
Sentence pattern: ${vc.sentenceLengthPattern || 'varied'}
Typical sentence length: ${vc.typicalSentenceLength || '8-12 words — punchy, not academic'}
Vocabulary: ${vc.vocabularyLevel || 'conversational'}
Signature phrases: ${(lf.signaturePhrases || []).join(', ') || 'none yet'}
Characteristic sentence openers: ${(lf.sentenceOpeners || []).join(' / ') || 'not yet captured'}
Rhetorical devices: ${(lf.rhetoricalDevices || []).join(', ') || 'none specified'}
Hook style: ${sp.hookStyle || 'drops straight into the action'}
How they build to a reveal: ${sp.revealBuildPattern || 'not yet captured'}
Transition phrases: ${(sp.transitionPhrases || []).join(' / ') || 'natural'}
Open loop style: ${sp.openLoopStyle || 'plants question early'}
CTA style: ${sp.ctaStyle || 'low pressure'}
Humour: ${lf.humourStyle || 'light, natural'}
Storytelling: ${lf.storytellingStyle || 'personal, first-person'}
Words/phrases to AVOID (not their voice): ${(lf.avoidPhrases || []).join(', ') || 'none specified'}
Rhythm note: ${vc.rhythmNote || 'not yet captured'}`);
  }

  // ── PERFORMANCE INTELLIGENCE ──────────────────────────────
  if (logInsights) {
    sections.push(`## WHAT WORKS FOR THIS CREATOR'S AUDIENCE
${logInsights}`);
  }

  if (latestAnalytics?.insights) {
    sections.push(`## ANALYTICS INSIGHTS
${latestAnalytics.insights}`);
  }

  // ── TOP PERFORMERS (weighted — most relevant examples) ────
  if (topPerformers.length) {
    sections.push(`## TOP PERFORMING EPISODES (study these patterns)
${topPerformers.map(e =>
  `Ep ${e.episode_number}: "${e.track_name}" — ${e.yt_retention_score || '?'}/100 retention
  Concept: ${e.episode_concept || 'N/A'}
  Hook used: ${e.generation_decisions?.hookVariantUsed?.slice(0, 80) || 'N/A'}`
).join('\n\n')}`);
  }

  // ── SERIES MEMORY ─────────────────────────────────────────
  if (seriesMemory.length) {
    sections.push(`## SERIES MEMORY — previous episodes
${seriesMemory.map(e =>
  `Ep ${e.episode_number}: "${e.track_name}" [${e.track_context?.mood || ''}]
  ${e.summary || ''}
  ${e.callback_seeds?.length ? `Can reference: ${e.callback_seeds.join(' | ')}` : ''}`
).join('\n\n')}`);
  }

  // ── TRENDING ──────────────────────────────────────────────
  if (trendingData?.analysis) {
    const t = trendingData.analysis;
    sections.push(`## TRENDING THIS WEEK (${category.niche})
Themes: ${(t.themes || []).slice(0, 4).join(', ')}
Recurring hooks: ${(t.recurringHooks || []).slice(0, 3).join(' | ')}
Emerging topics: ${(t.emergingTopics || []).slice(0, 3).join(', ')}
Emotional triggers working now: ${(t.emotionalTriggers || []).slice(0, 3).join(', ')}`);
  }

  // ── VAULT HIGHLIGHTS ──────────────────────────────────────
  if (vaultHighlights.length) {
    sections.push(`## VAULT — high-value unused ideas
${vaultHighlights.map(v =>
  `[${v.type}] "${v.title}": ${v.content.slice(0, 100)}...`
).join('\n')}`);
  }

  // ── RETENTION PATTERNS ────────────────────────────────────
  if (category.retention_db) {
    const db = category.retention_db;
    const hooks = (db.hookLibrary || []).filter(h => h.strength === 'A').slice(0, 5);
    if (hooks.length) {
      sections.push(`## PROVEN HOOK PATTERNS (Grade A only)
${hooks.map(h => `- ${h.pattern}: "${h.example}"`).join('\n')}`);
    }
  }

  // ── EPISODE IN PROGRESS ───────────────────────────────────
  if (episodeCtx) {
    sections.push(`## CURRENT EPISODE CONTEXT
Track: ${episodeCtx.trackName || 'untitled'}
Mood: ${episodeCtx.mood || ''}
Genre: ${episodeCtx.genre || ''}
Episode number: ${episodeCtx.episodeNumber || '?'}
Voice memo: ${episodeCtx.voiceMemoText ? `"${episodeCtx.voiceMemoText.slice(0, 300)}..."` : 'not provided yet'}`);
  }

  // ── PRIOR CONVERSATION ────────────────────────────────────
  if (chatHistory) {
    sections.push(`## PRIOR CONVERSATION CONTEXT
${chatHistory}`);
  }

  // ── MODE-SPECIFIC INSTRUCTIONS ───────────────────────────
  sections.push(getModeInstructions(mode));

  const result = sections.join('\n\n');
  if (cacheable) setCached(cacheKey, result);
  return result;
}

// ─── MODE INSTRUCTIONS ────────────────────────────────────────────────────────

function getModeInstructions(mode) {
  const instructions = {
    generate: `## YOUR ROLE IN GENERATE MODE
You are writing for this creator — always in their voice, never generic.
Think out loud before writing: explain your structural decisions (hook choice, intercut rhythm, trending angle).
Stream the VO script line by line. Flag anything that sounds written rather than spoken.
After generating, provide a mood/energy curve: rate emotional intensity 1-10 at each minute mark.`,

    vault: `## YOUR ROLE IN VAULT MODE
You have read access to this creator's full ideas library.
Surface connections and patterns they haven't noticed.
When asked to find ideas, rank by fit with current trends + past performance.
Recommend the 3 strongest unused ideas for this week unprompted.`,

    series: `## YOUR ROLE IN SERIES MODE
You know the full episode history. Think like a showrunner.
Identify narrative threads that could connect upcoming episodes.
Suggest callback opportunities — specific moments from past episodes worth referencing.
Think about the season arc: where is the creator's story going?`,

    analytics: `## YOUR ROLE IN ANALYTICS MODE
You are interpreting performance data, not just displaying it.
Explain WHY videos retained or dropped off — connect it to structural decisions.
Be specific: name timecodes, name episodes, name patterns.
Always end with 3 concrete recommendations for the next episode.`,

    teleprompter: `## YOUR ROLE IN TELEPROMPTER MODE
Review the VO script for speakability — flag lines that sound written not spoken.
Suggest simpler, more natural alternatives.
Mark emphasis points and natural pause locations.
Keep suggestions brief — the creator is about to record.`,

    sound: `## YOUR ROLE IN SOUND MODE
You are generating sound design briefs, not generic advice.
Know the track's BPM, mood, and genre — everything should serve those.
Be precise: timecodes, dB levels, specific atmosphere textures.
Stay in conversation — ask clarifying questions about the emotional intent of key scenes.`,
  };

  return instructions[mode] || instructions.generate;
}

// ─── DATA FETCHERS ────────────────────────────────────────────────────────────

async function getCategory(userId, categoryId) {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('id', categoryId)
    .eq('user_id', userId)
    .single();
  return data;
}

async function getRecentEpisodes(userId, categoryId, limit) {
  const { data } = await supabase
    .from('episodes')
    .select('episode_number, track_name, episode_concept, generation_decisions, yt_retention_score, status')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getTopPerformers(userId, categoryId, limit) {
  const { data } = await supabase
    .from('episodes')
    .select('episode_number, track_name, episode_concept, generation_decisions, yt_retention_score')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .not('yt_retention_score', 'is', null)
    .order('yt_retention_score', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getLatestAnalytics(userId, categoryId) {
  const { data } = await supabase
    .from('analytics_uploads')
    .select('insights, avg_score, top_performers, upload_date')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('upload_date', { ascending: false })
    .limit(1)
    .single();
  return data;
}

async function getSeriesMemory(userId, categoryId, limit) {
  const { data } = await supabase
    .from('series_memory')
    .select('episode_number, track_name, track_context, summary, callback_seeds, themes')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getLogInsights(userId, categoryId) {
  const { data } = await supabase
    .from('generation_log')
    .select('insights')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .not('insights', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();
  return data?.insights || null;
}

async function getTrendingData(categoryId) {
  const { data } = await supabase
    .from('categories')
    .select('trending_data, trending_refreshed_at')
    .eq('id', categoryId)
    .single();
  return data?.trending_data || null;
}

async function getVaultHighlights(userId, categoryId) {
  const { data } = await supabase
    .from('vault_entries')
    .select('type, title, content')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('is_favourite', true)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(5);
  return data || [];
}

function buildMinimalContext(mode) {
  return `# SCRIPTFORGE\nYou are the AI creative layer in ScriptForge.\nMode: ${mode.toUpperCase()}\nNo category context loaded yet — help the user get set up.`;
}

module.exports = { assembleContext, invalidateContext };
