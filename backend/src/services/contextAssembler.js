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
  const { mode = 'generate', episodeCtx, chatHistory, activeEpisodeId } = options;

  // Skip cache for generation (episode context changes) — cache chat/vault/series
  const cacheable = !episodeCtx && !activeEpisodeId && mode !== 'generate'
  const cacheKey  = `${userId}:${categoryId}:${mode}`
  if (cacheable) {
    const cached = getCached(cacheKey)
    if (cached) return cached
  }

  // FIX: recentVoiceMemos was referenced in the sections below but was NEVER
  // fetched — it was missing from the Promise.all entirely. Every assembleContext
  // call was hitting a ReferenceError on `recentVoiceMemos` (silently swallowed
  // by Railway). Added to the parallel fetch here.
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
    recentVoiceMemos,
    scheduleInfo,
    kbLearnings,
    activeEpisode,
    storyboardFrames,
    fullVault,
    retentionInsights,
    soundLibrary,
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
    getRecentVoiceMemos(userId, categoryId),
    getScheduleInfo(userId, categoryId),
    getKBLearnings(userId, categoryId),
    activeEpisodeId ? getActiveEpisode(activeEpisodeId, userId, mode) : Promise.resolve(null),
    getStoryboardFrames(userId, categoryId),
    getFullVault(userId, categoryId),
    getRetentionInsights(userId, categoryId),
    getSoundLibrary(userId),
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

  // ── PUBLISHING SCHEDULE ─────────────────────────────────────
  if (scheduleInfo && scheduleInfo.publishedCount > 0) {
    const s = scheduleInfo
    const overdueNote = s.isOverdue ? ` (OVERDUE by ${s.daysSinceLast - s.avgGapDays} days)` : ' (on track)'
    sections.push('## PUBLISHING SCHEDULE\n' +
      'Episodes published: ' + s.publishedCount + '\n' +
      'Average cadence: every ' + (s.avgGapDays || '?') + ' days\n' +
      'Days since last publish: ' + (s.daysSinceLast ?? '?') + overdueNote + '\n' +
      'Last published: "' + (s.lastEpName || 'none') + '"\n' +
      (s.nextRecommended ? 'Next recommended: ' + new Date(s.nextRecommended).toLocaleDateString('en', { weekday:'long', month:'long', day:'numeric' }) + '\n' : '') +
      'Consistency: ' + (s.consistency ?? '?') + '%')
  }

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

  // ── KB LEARNINGS (extracted from past conversations) ────────
  if (kbLearnings && kbLearnings.length) {
    const allInsights    = kbLearnings.flatMap(l => l.insights    || []).slice(-12)
    const allPreferences = kbLearnings.flatMap(l => l.preferences || []).slice(-8)
    const allVoiceNotes  = kbLearnings.flatMap(l => l.voice_notes || []).slice(-8)
    const allIdeas       = kbLearnings.flatMap(l => l.episode_ideas || []).slice(-6)
    const parts = []
    if (allInsights.length)    parts.push('What works for this creator:\n' + allInsights.map(i => '- ' + i).join('\n'))
    if (allPreferences.length) parts.push('Stated preferences:\n' + allPreferences.map(p => '- ' + p).join('\n'))
    if (allVoiceNotes.length)  parts.push('Voice notes:\n' + allVoiceNotes.map(v => '- ' + v).join('\n'))
    if (allIdeas.length)       parts.push('Episode ideas from past conversations:\n' + allIdeas.map(i => '- ' + i).join('\n'))
    if (parts.length) {
      sections.push('## KB MEMORY (learned from ' + kbLearnings.length + ' past conversation' + (kbLearnings.length > 1 ? 's' : '') + ')\n' +
        'Apply these learnings actively.\n\n' + parts.join('\n\n'))
    }
  }

  // ── ACTIVE EPISODE (what the creator has open right now) ────
  if (activeEpisode) {
    const ae = activeEpisode
    const aeParts = []
    aeParts.push('Episode: "' + ae.track_name + '" — Ep ' + (ae.episode_number || '?') + ' [' + (ae.status || 'unknown') + ']')
    if (ae.episode_concept) aeParts.push('Concept: ' + ae.episode_concept)
    if (ae.thumbnail_concept) aeParts.push('Thumbnail concept: ' + ae.thumbnail_concept)
    if (mode === 'teleprompter' && ae.vo_script) {
      aeParts.push('\nVO SCRIPT (full):\n' + ae.vo_script)
    } else if (ae.vo_script) {
      aeParts.push('VO script preview: ' + ae.vo_script.slice(0, 400) + (ae.vo_script.length > 400 ? '...' : ''))
    }
    if (mode === 'storyboard' && ae.storyboard && ae.storyboard.frames && ae.storyboard.frames.length) {
      const frameText = ae.storyboard.frames.map((f, i) =>
        'Shot ' + (i+1) + ' [' + (f.shot_type || 'unknown') + ']: ' + f.description + (f.notes ? ' — ' + f.notes : '')
      ).join('\n')
      aeParts.push('\nSTORYBOARD (' + ae.storyboard.frames.length + ' frames):\n' + frameText)
    }
    if (ae.yt_retention_score) aeParts.push('Retention score: ' + ae.yt_retention_score + '/100')
    if (ae.script_score) {
      const ss = ae.script_score
      aeParts.push('Script scores: hook ' + ss.hook + '/10, clarity ' + ss.clarity + '/10, retention ' + ss.retention + '/10')
    }
    sections.push('## ACTIVE EPISODE — open on screen right now\n' + aeParts.join('\n') + '\nRefer to this episode by name. Give specific advice, not generic.')
  }

  // ── HOOK PERFORMANCE ──────────────────────────────────────
  const publishedWithScores = (recentEpisodes || []).filter(e =>
    e.status === 'published' && e.yt_retention_score > 0 && e.generation_decisions && e.generation_decisions.hookType
  )
  if (publishedWithScores.length) {
    const hookMap = {}
    for (const ep of publishedWithScores) {
      const hookType = ep.generation_decisions.hookType
      if (!hookMap[hookType]) hookMap[hookType] = []
      hookMap[hookType].push(ep.yt_retention_score)
    }
    const hookSummary = Object.entries(hookMap)
      .map(([type, scores]) => ({ type, avg: Math.round(scores.reduce((s,n) => s+n,0)/scores.length), count: scores.length }))
      .sort((a,b) => b.avg - a.avg)
    sections.push('## HOOK PERFORMANCE (' + publishedWithScores.length + ' published episodes)\n' +
      hookSummary.map(h => h.type + ': avg ' + h.avg + '/100 (' + h.count + ' ep' + (h.count > 1 ? 's' : '') + ')').join('\n') + '\n' +
      'Best performing hook: ' + (hookSummary[0] ? hookSummary[0].type : 'unknown') + '. Lead new episodes with this style unless topic demands otherwise.')
  }

  // ── COMPETITOR INTELLIGENCE ────────────────────────────────
  if (category.competitor_intel && category.competitor_intel.summary) {
    const ci = category.competitor_intel
    let ciText = '## COMPETITOR INTELLIGENCE\n' + ci.summary
    if (ci.contentGaps && ci.contentGaps.length) ciText += '\nContent gaps: ' + ci.contentGaps.slice(0,3).join(' | ')
    if (ci.topPerformingFormats && ci.topPerformingFormats.length) ciText += '\nTop performing formats: ' + ci.topPerformingFormats.slice(0,3).join(' | ')
    sections.push(ciText)
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

  // ── AUDIENCE MODEL (demographics + research + own data) ────
  const audienceModel = category.audience_model
  if (audienceModel) {
    const parts = []
    const ytAudience = audienceModel.youtube
    if (ytAudience) {
      if (ytAudience.demographics) {
        const d = ytAudience.demographics
        parts.push('YouTube demographics: ' +
          (d.ageGender?.length ? d.ageGender.slice(0,3).map(g => g.ageGroup + ' ' + g.gender + ' ' + g.pct + '%').join(', ') : 'not available'))
      }
      if (ytAudience.topCountries?.length) {
        parts.push('Top countries: ' + ytAudience.topCountries.slice(0,4).map(c => c.country + ' ' + c.pct + '%').join(', '))
      }
      if (ytAudience.devices?.length) {
        parts.push('Primary device: ' + ytAudience.devices[0].device + ' (' + ytAudience.devices[0].pct + '% of views)')
      }
    }
    const geminiAudience = audienceModel.geminiInsights
    if (geminiAudience) {
      if (geminiAudience.psychographics?.corePainPoint) parts.push('Core pain point: ' + geminiAudience.psychographics.corePainPoint)
      if (geminiAudience.psychographics?.coreAspiration) parts.push('Core aspiration: ' + geminiAudience.psychographics.coreAspiration)
      if (geminiAudience.thumbnailPsychology?.emotionalTriggers?.length) parts.push('Click triggers: ' + geminiAudience.thumbnailPsychology.emotionalTriggers.join(', '))
    }
    const commentSentiment = audienceModel.commentSentiment
    if (commentSentiment) {
      if (commentSentiment.loves?.length) parts.push('What they love: ' + commentSentiment.loves.slice(0,3).join(' | '))
      if (commentSentiment.wants?.length) parts.push('What they want: ' + commentSentiment.wants.slice(0,3).join(' | '))
      if (commentSentiment.pain?.length)  parts.push('Pain points: ' + commentSentiment.pain.slice(0,2).join(' | '))
    }
    if (parts.length) {
      sections.push('## YOUR AUDIENCE\nThis is who you are creating for. Every hook, script, and thumbnail should be filtered through this lens.\n\n' + parts.join('\n'))
    }
  }

  // ── REACTION IMAGES (thumbnail asset library) ─────────────
  const reactionImages = category.reaction_images
  if (reactionImages && reactionImages.length) {
    const imgList = reactionImages.slice(0,8).map(img =>
      '[' + (img.tag || 'neutral') + '] ' + img.file_name
    ).join('\n')
    sections.push('## REACTION IMAGES (your face shots for thumbnails)\n' + imgList + '\nWhen suggesting thumbnails, reference these images by tag and instruct Flux to NOT alter the face — only change background and add text overlay.')
  }

  // ── TOP PERFORMERS — only real published episodes ────────
  if (topPerformers.length) {
    sections.push(`## TOP PERFORMING EPISODES (real published data only)
${topPerformers.map(e =>
  `Ep ${e.episode_number}: "${e.track_name}" — ${e.yt_retention_score}/100 retention${e.script_score ? ` · Gemini script score: ${e.script_score.overallScore}/100` : ''}
  Concept: ${e.episode_concept || 'N/A'}
  Hook used: ${e.generation_decisions?.hookVariantUsed?.slice(0, 80) || 'N/A'}${e.script_score?.topIssue ? `
  Gemini noted: ${e.script_score.topIssue}` : ''}`
).join('\n\n')}`)
  } else {
    sections.push(`## TOP PERFORMING EPISODES
No published episodes with real performance data yet. Do not reference or invent episode benchmarks. The creator is still in pre-launch — base all recommendations on the analytics upload data and industry knowledge only.`)
  }

  // ── RECENT VOICE MEMOS (raw ideas from Companion sessions) ──────────
  if (recentVoiceMemos?.length) {
    sections.push(`## RECENT COMPANION SESSIONS (creator's raw captured ideas)
These are voice sessions from the Companion app — the creator's unfiltered thinking.
${recentVoiceMemos.map(m => {
  const memo = (m.voice_memo_text || '').slice(0, 300)
  const transcript = (m.transcript || '').slice(0, 400)
  const moments = (m.key_moments || []).slice(0, 3).map(k => `• ${k}`).join('\n')
  return `[${new Date(m.created_at).toLocaleDateString()}${m.title ? ` — ${m.title}` : ''}]
Summary: "${memo}${memo.length >= 300 ? '...' : ''}"${moments ? `\nKey moments:\n${moments}` : ''}${transcript && !memo ? `\nTranscript excerpt: "${transcript.slice(0,200)}"` : ''}`
}).join('\n\n')}`)
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

  // ── STORYBOARD FRAMES ───────────────────────────────────────
  if (storyboardFrames && storyboardFrames.length) {
    const frameLines = storyboardFrames.map((f, i) =>
      'Shot ' + (f.position + 1) + ' [' + (f.shot_type || 'unknown').toUpperCase() + ']' +
      (f.section ? ' — ' + f.section : '') + '\n' +
      '  Capture: ' + f.description + '\n' +
      '  Notes: ' + (f.notes || 'none') +
      (f.matched_clip ? '\n  Matched clip: ' + f.matched_clip.filename : ' (no clip matched yet)')
    ).join('\n\n')
    sections.push('## CURRENT STORYBOARD (active shot list)\n' + frameLines)
  }

  // ── FULL VAULT ───────────────────────────────────────────────
  if (fullVault && fullVault.length) {
    const byType = {}
    for (const v of fullVault) {
      if (!byType[v.type]) byType[v.type] = []
      byType[v.type].push(v)
    }
    const vaultLines = Object.entries(byType).map(([type, items]) =>
      type.toUpperCase() + ' (' + items.length + '):\n' +
      items.slice(0, 8).map(v =>
        '  "' + v.title + '" — ' + v.content.slice(0, 120) + (v.content.length > 120 ? '...' : '') + (v.is_favourite ? ' ★' : '')
      ).join('\n')
    ).join('\n\n')
    sections.push('## VAULT — all unused ideas\n' + vaultLines + '\n★ = favourited. Prioritise starred items and those matching the current episode theme.')
  }

  // ── RETENTION INSIGHTS ───────────────────────────────────────
  if (retentionInsights && retentionInsights.length) {
    const insightLines = retentionInsights.slice(0, 5).map(ep =>
      '"' + ep.track_name + '" (Ep ' + (ep.episode_number || '?') + ') — score: ' + ep.yt_retention_score + '/100'
    ).join('\n')
    sections.push('## RETENTION PATTERNS\nReal retention from published episodes.\n' + insightLines)
  }

  // ── SOUND LIBRARY ────────────────────────────────────────────
  if (soundLibrary && soundLibrary.assets && soundLibrary.assets.length) {
    const lib = soundLibrary
    const assetLines = lib.assets.slice(0, 20).map(a =>
      '[' + (a.category || 'misc') + '] "' + a.name + '"' +
      (a.bpm ? ' — ' + a.bpm + 'BPM' : '') +
      (a.energy_level ? ', energy: ' + a.energy_level : '') +
      (a.duration_ms ? ', ' + Math.round(a.duration_ms/1000) + 's' : '')
    ).join('\n')
    sections.push('## SOUND LIBRARY (' + lib.total + ' assets, ' + (lib.libraries?.length || 0) + ' libraries)\n' + assetLines + '\nIn sound mode, reference these by name when suggesting placements.')
  }

  // ── TRENDING ──────────────────────────────────────────────────
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
  // FIX: explicit no-markdown instruction added to base. The previous prompt said
  // "No bullet lists unless asked" but didn't ban **bold**, *italic*, or ## headers,
  // so Claude defaulted to markdown which rendered as raw symbols in the chat UI.
  const base = `## HOW TO RESPOND
You are a sharp creative collaborator — talk like a talented friend, not a system.
NEVER start responses with headers, mode announcements, or labels like "# KB MODE".
NEVER say "I'm here" or announce your status. Just respond to what was said.
CRITICAL FORMATTING RULE — NO EXCEPTIONS: Never use markdown symbols of any kind. No **bold**, no *italic*, no ## headers, no # headers, no bullet points with -, no numbered lists, no backticks, no --- dividers. Never use em dashes (—) or en dashes (–). Write everything as plain conversational prose only. You CAN use line breaks between paragraphs. No **bold**, no *italic*, no ## headers, no bullet points with -, no backticks. Never use em dashes (—) or en dashes (–) — use a comma, period, or rewrite the sentence instead. Use plain prose. You CAN use line breaks between paragraphs for readability.
Keep responses SHORT — max 4-6 sentences for chat, more only when writing actual content.
No bullet lists unless asked. No preamble. Lead with the actual insight or idea.
Do not explain your reasoning unless asked. Just give the answer.`

  const instructions = {
    generate: base + `
In generate mode, always lead ideation from the thumbnail. Every great episode starts with the visual moment that stops the scroll — nail that first, then the hook, then the script. Ask: "What's the image? What's the text overlay? What emotion does it trigger in your specific viewer?" Only once the thumbnail concept is locked does the script direction become clear. The hook must deliver on the thumbnail promise. If thumbnail_concept is already set, use it to anchor the opening line.
When asked to generate, write in their voice. Don't think out loud — just produce.`,
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
    .select('episode_number, track_name, episode_concept, generation_decisions, yt_retention_score, script_score, status')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getTopPerformers(userId, categoryId, limit) {
  const { data } = await supabase
    .from('episodes')
    .select('episode_number, track_name, episode_concept, generation_decisions, yt_retention_score, script_score, status')
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

// FIX: table name corrected from 'sessions' → 'session_journals'.
// The old name caused every call to silently return [] since the table was
// renamed. This function is now also correctly wired into the Promise.all above.
async function getRecentVoiceMemos(userId, categoryId) {
  try {
    const { data } = await supabase
      .from('session_journals')
      .select('voice_memo_text, transcript, key_moments, created_at, title')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .not('voice_memo_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3)
    return data || []
  } catch { return [] }
}

// ── ACTIVE EPISODE FETCHER ───────────────────────────────────────────────────
async function getActiveEpisode(episodeId, userId, mode) {
  try {
    const { data: ep } = await supabase
      .from('episodes')
      .select('id, episode_number, track_name, status, episode_concept, summary, themes, thumbnail_concept, vo_script, script_score, yt_retention_score, retention_curve_map, generation_decisions')
      .eq('id', episodeId)
      .eq('user_id', userId)
      .single()
    if (!ep) return null
    if (mode === 'storyboard') {
      const { data: board } = await supabase
        .from('storyboards').select('id')
        .eq('episode_id', episodeId).eq('user_id', userId)
        .order('updated_at', { ascending: false }).limit(1).single()
      if (board) {
        const { data: frames } = await supabase
          .from('storyboard_frames').select('position, shot_type, description, notes, section')
          .eq('storyboard_id', board.id).order('position', { ascending: true }).limit(30)
        ep.storyboard = { frames: frames || [] }
      }
    }
    return ep
  } catch { return null }
}

// ── KB LEARNINGS FETCHER ─────────────────────────────────────────────────────
async function getKBLearnings(userId, categoryId) {
  try {
    const { data } = await supabase
      .from('kb_learnings')
      .select('insights, preferences, voice_notes, episode_ideas, extracted_at')
      .eq('user_id', userId).eq('category_id', categoryId)
      .order('extracted_at', { ascending: false }).limit(20)
    return data || []
  } catch { return [] }
}

// ── SCHEDULE FETCHER ─────────────────────────────────────────────────────────
async function getScheduleInfo(userId, categoryId) {
  try {
    const { data: episodes } = await supabase
      .from('episodes')
      .select('episode_number, track_name, status, published_at')
      .eq('user_id', userId).eq('category_id', categoryId)
      .eq('status', 'published').not('published_at', 'is', null)
      .order('published_at', { ascending: false }).limit(20)
    const published = episodes || []
    if (published.length === 0) return { publishedCount: 0 }
    const dates = published.map(e => new Date(e.published_at).getTime())
    const gaps = []
    for (let i = 0; i < dates.length - 1; i++) gaps.push((dates[i] - dates[i+1]) / 86400000)
    const avgGapDays  = gaps.length ? Math.round(gaps.reduce((s,g) => s+g, 0) / gaps.length) : null
    const daysSince   = Math.round((Date.now() - dates[0]) / 86400000)
    const nextDate    = avgGapDays ? new Date(dates[0] + avgGapDays * 86400000) : null
    const isOverdue   = avgGapDays ? daysSince > avgGapDays * 1.5 : false
    const mean = avgGapDays || 0
    const variance = gaps.length ? gaps.reduce((s,g) => s + (g-mean)**2, 0) / gaps.length : 0
    const consistency = Math.max(0, 100 - Math.round(Math.sqrt(variance) * 5))
    return { publishedCount: published.length, avgGapDays, daysSinceLast: daysSince, lastPublished: published[0].published_at, lastEpName: published[0].track_name, nextRecommended: nextDate?.toISOString() || null, isOverdue, consistency }
  } catch { return null }
}

// ── HIGH VALUE FETCHERS ──────────────────────────────────────────────────────

async function getStoryboardFrames(userId, categoryId) {
  try {
    const { data: board } = await supabase
      .from('storyboards')
      .select('id')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
    if (!board) return []
    const { data: frames } = await supabase
      .from('storyboard_frames')
      .select('position, shot_type, section, description, notes, matched_clip:clip_index(filename, transcript)')
      .eq('storyboard_id', board.id)
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .limit(30)
    return frames || []
  } catch { return [] }
}

async function getFullVault(userId, categoryId) {
  try {
    const { data } = await supabase
      .from('vault_entries')
      .select('type, title, content, tags, is_favourite')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .is('used_at', null)
      .order('is_favourite', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60)
    return data || []
  } catch { return [] }
}

async function getRetentionInsights(userId, categoryId) {
  try {
    const { data } = await supabase
      .from('episodes')
      .select('episode_number, track_name, yt_retention_score, retention_patterns, retention_curve_map')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .eq('status', 'published')
      .not('yt_retention_score', 'is', null)
      .gt('yt_retention_score', 0)
      .order('yt_retention_score', { ascending: false })
      .limit(10)
    return data || []
  } catch { return [] }
}

async function getSoundLibrary(userId) {
  try {
    const { data: libraries } = await supabase
      .from('sound_libraries')
      .select('id, name')
      .eq('user_id', userId)
      .limit(10)
    if (!libraries?.length) return null
    const { data: assets, count } = await supabase
      .from('sound_assets')
      .select('name, category, bpm, energy_level, duration_ms, use_count', { count: 'exact' })
      .in('library_id', libraries.map(l => l.id))
      .order('use_count', { ascending: false })
      .limit(40)
    return { libraries, assets: assets || [], total: count || 0 }
  } catch { return null }
}

module.exports = { assembleContext, invalidateContext };
