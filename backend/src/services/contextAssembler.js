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
    clipIndexData,
    scriptLibrary,
    plannedEpisodes,
  ] = await Promise.all([
    getCategory(userId, categoryId),
    getRecentEpisodes(userId, categoryId, 5),
    getTopPerformers(userId, categoryId, 3),
    getLatestAnalytics(userId, categoryId),
    getSeriesMemory(userId, categoryId, 8),
    getLogInsights(userId, categoryId),
    getTrendingData(categoryId),
    getVaultHighlights(userId, categoryId),
    getClipIndexData(userId),
    getScriptLibrary(userId, categoryId),
    getPlannedEpisodes(userId, categoryId),
  ]);

  if (!category) return buildMinimalContext(mode);

  const sections = [];

  // ── IDENTITY ──────────────────────────────────────────────
  sections.push(`# WHISPACUTS CONTEXT
You are the AI creative layer inside WhispaCuts, a content production system for a solo creator.
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

  if (latestAnalytics?.length) {
    const latest = latestAnalytics[0]
    const trend  = latestAnalytics.length >= 2
      ? (latestAnalytics[0].avg_score || 0) - (latestAnalytics[1].avg_score || 0)
      : null
    const allTimeAvg = Math.round(
      latestAnalytics.reduce((s, u) => s + (u.avg_score || 0), 0) / latestAnalytics.length
    )

    const scoreHistory = [...latestAnalytics].reverse().map(u =>
      `  ${new Date(u.upload_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}: ${u.avg_score}% avg (${u.video_count} videos)`
    ).join('\n')

    const topVideos = (latest.top_performers || []).slice(0, 8).map((v, i) =>
      `  ${i+1}. "${v.title}" — score: ${v.retentionScore}%${v.views ? `, views: ${v.views.toLocaleString()}` : ''}${v.ctr ? `, CTR: ${v.ctr.toFixed(1)}%` : ''}${v.avgViewPercentage ? `, avg view: ${v.avgViewPercentage}%` : ''}`
    ).join('\n')

    sections.push(`## ANALYTICS DATA
All-time avg retention score: ${allTimeAvg}%${trend !== null ? ` (${trend >= 0 ? '+' : ''}${trend.toFixed(0)}pts vs previous batch)` : ''}
Total upload batches: ${latestAnalytics.length}
Total videos tracked: ${latestAnalytics.reduce((s, u) => s + (u.video_count || 0), 0)}

Score history (oldest → newest):
${scoreHistory}

Latest batch top performers:
${topVideos || '  No video data yet'}

Latest batch AI insights: ${latest.insights || 'Not yet generated'}`)
  }

  // ── TOP PERFORMERS — only real published episodes ────────
  if (topPerformers.length) {
    sections.push(`## TOP PERFORMING EPISODES (real published data only)
${topPerformers.map(e =>
  `Ep ${e.episode_number}: "${e.track_name}" — ${e.yt_retention_score}/100 retention
  Concept: ${e.episode_concept || 'N/A'}
  Hook used: ${e.generation_decisions?.hookVariantUsed?.slice(0, 80) || 'N/A'}`
).join('\n\n')}`)
  } else {
    sections.push(`## TOP PERFORMING EPISODES
No published episodes with real performance data yet. Do not reference or invent episode benchmarks. The creator is still in pre-launch — base all recommendations on the analytics upload data and industry knowledge only.`)
  }

  // ── RECENT VOICE MEMOS (raw ideas from Companion sessions) ──────────
  if (recentVoiceMemos?.length) {
    sections.push(`## RECENT VOICE MEMOS
These are unfiltered notes the creator recorded during production sessions — their raw thinking in their own words.
${recentVoiceMemos.map(m =>
  `[${new Date(m.created_at).toLocaleDateString()}${m.title ? ` — ${m.title}` : ''}]
"${(m.voice_memo_text || '').slice(0, 400)}${m.voice_memo_text?.length > 400 ? '...' : ''}"`
).join('\n\n')}`)
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

  // ── KB PLANNED EPISODES ───────────────────────────────────
  if (plannedEpisodes.length) {
    sections.push(`## KB PLANNED EPISODES — mapped out in chat, not yet recorded
${plannedEpisodes.map(e =>
  `Ep ${e.episode_number ? e.episode_number + ': ' : ''}"${e.track_name}" [${e.status}] — ${e.summary || ''}${e.themes?.length ? ` | themes: ${e.themes.join(', ')}` : ''}`
).join('\n')}
These are committed from previous KB conversations — the creator plans to record these.`)
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

  // ── CLIP INDEX ─────────────────────────────────────────────
  if (clipIndexData && clipIndexData.total > 0) {
    const byType = clipIndexData.byType || {}
    const totalMins = Math.round((clipIndexData.totalDurationMs || 0) / 60000)
    const clipLines = (clipIndexData.clips || []).map(c =>
      `  [${c.clip_type}] ${c.filename}${c.duration_ms ? ` (${Math.round(c.duration_ms/1000)}s)` : ''}${c.transcript ? ` — "${c.transcript.slice(0, 120)}${c.transcript.length > 120 ? '...' : ''}"` : ''}${c.visual_tags?.length ? ` | tags: ${c.visual_tags.slice(0,4).join(', ')}` : ''}`
    ).join('\n')

    sections.push(`## INDEXED FOOTAGE LIBRARY
Total clips: ${clipIndexData.total} | cam: ${byType.cam||0} | daw: ${byType.daw||0} | broll: ${byType.broll||0} | total duration: ~${totalMins} min
${clipLines}`)
  }

  // ── VAULT HIGHLIGHTS ──────────────────────────────────────
  if (vaultHighlights.length) {
    sections.push(`## VAULT — high-value unused ideas
${vaultHighlights.map(v =>
  `[${v.type}] "${v.title}": ${v.content.slice(0, 100)}...`
).join('\n')}`);
  }

  // ── SCRIPT LIBRARY ────────────────────────────────────────
  if (scriptLibrary.own.length || scriptLibrary.competitor.length || scriptLibrary.shorts.length) {
    const parts = []
    if (scriptLibrary.own.length) {
      parts.push(`OWN LONG-FORM SCRIPTS (${scriptLibrary.own.length}):\n${scriptLibrary.own.map(s =>
        `  "${s.title}" — ${s.content.slice(0, 300)}${s.content.length > 300 ? '...' : ''}`
      ).join('\n\n')}`)
    }
    if (scriptLibrary.shorts.length) {
      parts.push(`SHORTS/TIKTOK SCRIPTS (${scriptLibrary.shorts.length}):\n${scriptLibrary.shorts.map(s =>
        `  "${s.title}" — ${s.content.slice(0, 200)}${s.content.length > 200 ? '...' : ''}`
      ).join('\n\n')}`)
    }
    if (scriptLibrary.competitor.length) {
      parts.push(`COMPETITOR SCRIPTS TO STUDY (${scriptLibrary.competitor.length}):\n${scriptLibrary.competitor.map(s =>
        `  "${s.title}" — ${s.content.slice(0, 300)}${s.content.length > 300 ? '...' : ''}`
      ).join('\n\n')}`)
    }
    sections.push(`## SCRIPT LIBRARY\n${parts.join('\n\n')}`)
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
  const base = `## HOW TO RESPOND
You are a sharp creative collaborator — talk like a talented friend, not a system.
NEVER start responses with headers, mode announcements, or labels like "# KB MODE".
NEVER say "I'm here" or announce your status. Just respond to what was said.
Keep responses SHORT — max 4-6 sentences for chat, more only when writing actual content.
No bullet lists unless asked. No preamble. Lead with the actual insight or idea.
Do not explain your reasoning unless asked. Just give the answer.`

  const instructions = {
    generate: base + `
In generate mode: help the creator develop episode ideas. When asked to generate, write in their voice. Don't think out loud — just produce.`,
    vault:    base + `
In vault mode: surface ideas from their library. Be specific — name the idea, why it fits now.`,
    series:   base + `
In series mode: think like a showrunner. Spot narrative threads, callback opportunities, arc development.`,
    analytics: base + `
In analytics mode: interpret numbers, don't just display them. Name the cause, give 1-2 concrete next steps.`,
    teleprompter: base + `
In teleprompter mode: flag lines that sound written not spoken. Keep it brief — creator is about to record.`,
    sound:    base + `
In sound mode: give precise sound design direction. BPM, texture, timecode. Ask one clarifying question if needed.`,
    editor:   base + `
In editor mode: help with clip selection, edit structure, pacing decisions.`,
    storyboard: base + `
In storyboard mode: suggest shot types, framing, visual coverage.`,
  }

  return instructions[mode] || instructions.generate
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
    .select('episode_number, track_name, episode_concept, generation_decisions, yt_retention_score, status')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('status', 'published')           // only real published episodes
    .not('yt_retention_score', 'is', null)
    .gt('yt_retention_score', 0)         // must have a real score
    .order('yt_retention_score', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getLatestAnalytics(userId, categoryId) {
  const { data } = await supabase
    .from('analytics_uploads')
    .select('insights, avg_score, top_performers, upload_date, video_count, platform')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('upload_date', { ascending: false })
    .limit(8)
  return data || []
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

async function getClipIndexData(userId) {
  const { data, count } = await supabase
    .from('clip_index')
    .select('filename, clip_type, duration_ms, transcript, visual_tags', { count: 'exact' })
    .eq('user_id', userId)
    .not('indexed_at', 'is', null)
    .order('indexed_at', { ascending: false })
    .limit(50)

  if (!data || data.length === 0) return null

  const byType = data.reduce((acc, c) => {
    acc[c.clip_type] = (acc[c.clip_type] || 0) + 1
    return acc
  }, {})

  const totalDurationMs = data.reduce((s, c) => s + (c.duration_ms || 0), 0)

  return { total: count || data.length, byType, totalDurationMs, clips: data }
}

async function getPlannedEpisodes(userId, categoryId) {
  const { data } = await supabase
    .from('kb_planned_episodes')
    .select('episode_number, track_name, track_context, summary, themes, status')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: true })
    .limit(20)
  return data || []
}

async function getScriptLibrary(userId, categoryId) {
  const { data } = await supabase
    .from('vault_entries')
    .select('title, content, tags')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('type', 'script')
    .order('created_at', { ascending: false })
    .limit(20)

  const entries = data || []
  return {
    own:        entries.filter(s => !s.tags?.includes('competitor') && !s.tags?.includes('shorts') && !s.tags?.includes('tiktok')),
    shorts:     entries.filter(s => s.tags?.includes('shorts') || s.tags?.includes('tiktok')),
    competitor: entries.filter(s => s.tags?.includes('competitor')),
  }
}

function buildMinimalContext(mode) {
  return `# WHISPACUTS\nYou are the AI creative layer in WhispaCuts.\nMode: ${mode.toUpperCase()}\nNo category context loaded yet — help the user get set up.`;
}

async function getRecentVoiceMemos(userId, categoryId) {
  try {
    const { data } = await supabase
      .from('sessions')
      .select('voice_memo_text, created_at, title')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .not('voice_memo_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3)
    return data || []
  } catch { return [] }
}

module.exports = { assembleContext, invalidateContext };