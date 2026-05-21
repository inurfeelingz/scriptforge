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
  const cacheable = !episodeCtx && mode !== 'generate'
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
    audienceUploads,
    reactionImages,
    storyboardFrames,
    fullVault,
    retentionInsights,
    soundLibrary,
    seriesBible,
    dailyBrief,
    scheduleInfo,
    kbLearnings,
    activeEpisode,
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
    getAudienceUploads(userId, categoryId),
    getReactionImages(userId, categoryId),
    getStoryboardFrames(userId, categoryId),
    getFullVault(userId, categoryId),
    getRetentionInsights(userId, categoryId),
    getSoundLibrary(userId),
    getSeriesBible(userId, categoryId),
    getDailyBrief(userId, categoryId),
    getScheduleInfo(userId, categoryId),
    getKBLearnings(userId, categoryId),
    activeEpisodeId ? getActiveEpisode(activeEpisodeId, userId, mode) : Promise.resolve(null),
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

  // ── SERIES BIBLE ──────────────────────────────────────────────
  // The living show document — premise, voice, themes, narrative threads,
  // callbacks, previously-on. This is KB's understanding of the show as a whole.
  if (seriesBible?.available) {
    const b = seriesBible
    const threads = (b.narrativeThreads || []).slice(0, 3)
      .map(t => `${t.thread}: ${t.description} (eps ${(t.episodes || []).join(', ')})`)
      .join(' | ')
    const callbacks = (b.callbackOpportunities || []).slice(0, 3)
      .map(c => `From ${c.from} → ${c.suggestion}`)
      .join(' | ')

    sections.push(`## SERIES BIBLE (${b.episodeCount} episodes, ${b.publishedCount} published)
Show premise: ${b.showPremise || 'not yet generated'}
Creator voice: ${b.creatorVoice || 'see voice profile'}
Recurring themes: ${(b.recurringThemes || []).join(', ')}
Narrative threads: ${threads || 'none yet'}
Best performing structures: ${(b.bestPerformingStructures || []).slice(0, 2).map(s => s.structure + ' — ' + s.description).join(' | ') || 'none yet'}
Callback opportunities: ${callbacks || 'none yet'}
Upcoming directions: ${(b.upcomingDirections || []).join(', ') || 'none suggested'}
Previously on: ${b.previouslyOn || 'no summary yet'}
Collaborator brief: ${b.collaboratorBrief || 'not yet generated'}
Generated: ${b.generatedAt ? new Date(b.generatedAt).toLocaleDateString() : 'never'}`)
  }

  // ── DAILY BRIEF (pipeline state + what to work on today) ──
  // Tells KB what stage the creator is at and what action is most urgent.
  // KB should reinforce the brief's recommendation in conversation.
  if (dailyBrief?.directive) {
    const p = dailyBrief.pipeline || {}
    const pipelineStr = [
      p.readyToRecord  ? `Ep ${p.readyToRecord.episode_number} "${p.readyToRecord.track_name}" is generated — ready to record` : null,
      p.readyToEdit    ? `Ep ${p.readyToEdit.episode_number} "${p.readyToEdit.track_name}" is recorded — ready to edit` : null,
      p.readyToPublish ? `Ep ${p.readyToPublish.episode_number} "${p.readyToPublish.track_name}" is edited — ready to publish` : null,
      p.daysSinceLastPublish != null ? `Last published ${p.daysSinceLastPublish} days ago` : null,
      p.nothingInFlight ? `No episodes currently in progress` : null,
    ].filter(Boolean).join(' | ')

    sections.push(`## TODAY'S BRIEF
Directive: ${dailyBrief.directive}
Recommended action: ${dailyBrief.action || 'GENERATE'}
Pipeline: ${pipelineStr || 'no pipeline data'}
When the creator asks what to work on, lead with this directive. When they are clearly working on something else, stay focused on that — but mention the directive if there's a natural opening.`)
  }

  // ── PUBLISHING SCHEDULE ─────────────────────────────────────
  if (scheduleInfo) {
    const s = scheduleInfo
    sections.push(`## PUBLISHING SCHEDULE
Episodes published: ${s.publishedCount}
Average cadence: every ${s.avgGapDays || '?'} days
Days since last publish: ${s.daysSinceLast ?? '?'}${s.isOverdue ? ' (OVERDUE)' : ' (on track)'}
Last published: "${s.lastEpName || 'none'}" on ${s.lastPublished ? new Date(s.lastPublished).toLocaleDateString() : 'never'}
Next recommended publish: ${s.nextRecommended ? new Date(s.nextRecommended).toLocaleDateString('en', { weekday:'long', month:'long', day:'numeric' }) : 'not enough data yet'}
Cadence consistency: ${s.consistency ?? '?'}%${s.isOverdue ? `
ALERT: Creator is ${s.daysSinceLast - s.avgGapDays} days overdue. Factor this into planning advice.` : ''}`)
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

  // ── AUDIENCE MODEL ────────────────────────────────────────
  // Assembled from YouTube demographics, own data uploads, and Gemini research.
  // This is the most important context for creative decisions — KB filters
  // every hook, script, and thumbnail through who is actually watching.
  const audienceModel = category.audience_model || {}
  const geminiAudience = audienceModel.geminiInsights
  const ytDemographics = audienceModel.youtube
  const ownDataSummaries = audienceModel.ownData?.allSummaries || []

  if (geminiAudience || ytDemographics || ownDataSummaries.length || audienceUploads.length) {
    const parts = []

    // YouTube demographics (real channel data)
    if (ytDemographics) {
      const topCountries = ytDemographics.geography?.topCountries?.slice(0,5).map(c => `${c.country} (${c.pct}%)`).join(', ')
      const topDevice    = ytDemographics.devices?.[0]
      const topTraffic   = ytDemographics.trafficSources?.[0]
      const subSplit     = ytDemographics.subscriberSplit

      parts.push(`YouTube channel data:
Top markets: ${topCountries || 'not yet pulled'}
Primary device: ${topDevice ? `${topDevice.device} (${topDevice.pct}% of views)` : 'unknown'}
Top traffic source: ${topTraffic ? `${topTraffic.source} (${topTraffic.pct}% of views, avg ${topTraffic.avgViewPct?.toFixed(1)}% retention)` : 'unknown'}
Age group: ${ytDemographics.ageGender?.topAgeGroup || 'unknown'} (${ytDemographics.ageGender?.topAgeGroupPct || 0}% of viewers)${subSplit?.SUBSCRIBED ? `
Subscriber retention: ${subSplit.SUBSCRIBED.avgViewPct?.toFixed(1)}% vs non-subscriber: ${subSplit.UNSUBSCRIBED?.avgViewPct?.toFixed(1)}%` : ''}`)
    }

    // Gemini audience research (niche intelligence)
    if (geminiAudience) {
      const pa = geminiAudience.primaryAudience    || {}
      const ps = geminiAudience.psychographics     || {}
      const cb = geminiAudience.contentBehaviour   || {}
      const tp = geminiAudience.thumbnailPsychology || {}
      const gaps = geminiAudience.contentGaps      || []

      parts.push(`Gemini audience research (${geminiAudience.researchedAt ? new Date(geminiAudience.researchedAt).toLocaleDateString() : 'recent'}):
Who they are: ${pa.ageRange || 'unknown'} | ${pa.genderSplit || 'unknown'} | ${pa.incomeLevel || 'unknown'}
Core pain point: ${ps.corePainPoint || 'not researched yet'}
Core aspiration: ${ps.coreAspiration || 'not researched yet'}
Why they watch: ${ps.contentMotivation || 'not researched yet'}
How they see themselves: ${ps.identityStatement || 'not researched yet'}
When they watch: ${cb.peakWatchTimes || 'unknown'} | Preferred length: ${cb.preferredContentLength || 'unknown'}
How they discover: ${cb.discoveryMethod || 'unknown'}
Thumbnail emotional triggers: ${tp.emotionalTriggers?.join(', ') || 'none researched'}
Thumbnail visual patterns: ${tp.visualPatterns || 'not researched'}
Title formulas that work: ${tp.titleFormulas?.join(' | ') || 'none researched'}
What to avoid: ${tp.whatToAvoid || 'none noted'}
Content gaps to fill: ${gaps.slice(0,3).join(' | ') || 'none identified'}`)
    }

    // YouTube comment sentiment
    if (commentSentiment?.loves?.length || commentSentiment?.wants?.length) {
      const cs = commentSentiment
      parts.push(`Audience comment sentiment (${cs.commentCount || '?'} comments analysed, score ${cs.sentimentScore || '?'}/100):
What they love: ${cs.loves?.slice(0,3).join(' | ') || 'not yet analysed'}
What they want: ${cs.wants?.slice(0,3).join(' | ') || 'not yet analysed'}
Pain points: ${cs.pain?.slice(0,2).join(' | ') || 'none identified'}
Emotional triggers: ${cs.emotionalTriggers?.slice(0,2).join(' | ') || 'none identified'}
Recurring phrases: ${cs.topPhrases?.slice(0,4).join(', ') || 'none identified'}`)
    }

    // Own data uploads (ProjectFeelz users, personas, surveys)
    if (ownDataSummaries.length) {
      parts.push(`Own audience data (${ownDataSummaries.length} upload${ownDataSummaries.length > 1 ? 's' : ''}):
${ownDataSummaries.slice(-3).map(s => `[${s.fileName}]: ${s.personaSummary?.slice(0, 300)}${s.personaSummary?.length > 300 ? '...' : ''}`).join('

')}`)
    } else if (audienceUploads.length) {
      parts.push(`Own audience data:
${audienceUploads.map(u => `[${u.file_name} — ${u.row_count} records]: ${u.persona_summary?.slice(0, 300) || 'Summary not available'}${u.persona_summary?.length > 300 ? '...' : ''}`).join('

')}`)
    }

    sections.push(`## YOUR AUDIENCE
This is who you are creating for. Every hook, script, and thumbnail decision should be filtered through this lens.

${parts.join('

')}`)
  }

  // ── REACTION IMAGES (thumbnail asset library) ───────────────
  if (reactionImages?.length) {
    sections.push(`## CREATOR REACTION IMAGES (thumbnail asset library)
These are the creator's own photos available for thumbnail generation. When generating a Flux prompt, reference these by tag. Never alter the face.
${reactionImages.map(r => `[${r.tag}] — ${r.file_name} (URL: ${r.storage_url})`).join('\n')}
When generating a thumbnail Flux prompt: specify which reaction tag to use, describe the background/environment to add around the creator, and include "Do NOT alter the face, expression, or skin tone. Composite only." in the prompt.`)
  }

  // ── KB LEARNINGS (extracted from past conversations) ────────
  // This is KB's growing memory — insights, preferences, voice notes, and
  // episode ideas extracted from previous conversations with this creator.
  if (kbLearnings?.length) {
    const allInsights    = kbLearnings.flatMap(l => l.insights    || []).slice(-12)
    const allPreferences = kbLearnings.flatMap(l => l.preferences || []).slice(-8)
    const allVoiceNotes  = kbLearnings.flatMap(l => l.voice_notes || []).slice(-8)
    const allIdeas       = kbLearnings.flatMap(l => l.episode_ideas || []).slice(-6)

    const parts = []
    if (allInsights.length)    parts.push(`What works for this creator:\n${allInsights.map(i => `- ${i}`).join('\n')}`)
    if (allPreferences.length) parts.push(`Stated preferences:\n${allPreferences.map(p => `- ${p}`).join('\n')}`)
    if (allVoiceNotes.length)  parts.push(`Voice notes:\n${allVoiceNotes.map(v => `- ${v}`).join('\n')}`)
    if (allIdeas.length)       parts.push(`Episode ideas from past conversations:\n${allIdeas.map(i => `- ${i}`).join('\n')}`)

    if (parts.length) {
      sections.push(`## KB MEMORY (learned from ${kbLearnings.length} past conversation${kbLearnings.length > 1 ? 's' : ''})
This is what KB has learned about this creator over time. Apply these learnings actively.
${parts.join('\n\n')}`)
    }
  }

  // ── ACTIVE EPISODE (what the creator has open right now) ────
  // Injected when the creator is on Teleprompter, Storyboard, EpisodeReview, or Generate.
  // KB reads the exact content on screen so advice is specific, not general.
  if (activeEpisode) {
    const ae = activeEpisode
    const parts = []

    parts.push(`Episode: "${ae.track_name}" — Ep ${ae.episode_number || '?'} [${ae.status || 'unknown'}]`)

    if (ae.episode_concept) parts.push(`Concept: ${ae.episode_concept}`)
    if (ae.summary)         parts.push(`Summary: ${ae.summary}`)
    if (ae.themes?.length)  parts.push(`Themes: ${ae.themes.join(', ')}`)
    if (ae.thumbnail_concept) parts.push(`Thumbnail concept: ${ae.thumbnail_concept}`)

    // Mode-aware content injection
    if (mode === 'teleprompter' && ae.vo_script) {
      parts.push(`\nVO SCRIPT (full — this is what the creator is reviewing/recording):\n${ae.vo_script}`)
    } else if (ae.vo_script) {
      parts.push(`VO script preview: ${ae.vo_script.slice(0, 400)}${ae.vo_script.length > 400 ? '...' : ''}`)
    }

    if (mode === 'storyboard' && ae.storyboard) {
      const frames = ae.storyboard.frames || []
      if (frames.length) {
        parts.push(`\nSTORYBOARD (${frames.length} frames — this is what the creator is working on):\n${
          frames.map((f, i) => `Shot ${i+1} [${f.shot_type || 'unknown'}]: ${f.description}${f.notes ? ` — ${f.notes}` : ''}`).join('\n')
        }`)
      }
    }

    if (ae.yt_retention_score) {
      parts.push(`Retention score: ${ae.yt_retention_score}/100`)
    }

    if (ae.retention_curve_map && typeof ae.retention_curve_map === 'object') {
      const entries = Object.entries(ae.retention_curve_map)
        .map(([sec, pct]) => ({ sec: parseInt(sec), pct: parseFloat(pct) }))
        .sort((a, b) => a.sec - b.sec)
      if (entries.length) {
        const drops = []
        for (let i = 1; i < entries.length; i++) {
          const drop = entries[i-1].pct - entries[i].pct
          if (drop >= 5) {
            const m = Math.floor(entries[i].sec / 60), s = entries[i].sec % 60
            drops.push(`${m}:${String(s).padStart(2,'0')} (${drop.toFixed(0)}% drop)`)
          }
        }
        if (drops.length) parts.push(`Drop-off points: ${drops.slice(0,4).join(', ')}`)
      }
    }

    if (ae.script_score) {
      const ss = ae.script_score
      parts.push(`Script scores: hook ${ss.hook}/10, clarity ${ss.clarity}/10, retention ${ss.retention}/10`)
    }

    sections.push(`## ACTIVE EPISODE — open on screen right now
${parts.join('\n')}
Refer to this episode by name. Give advice specific to this content, not generic.`)
  }

  // ── HOOK PERFORMANCE (what's working by hook type) ──────────
  // Cross-references hook types used in generated episodes with their retention scores.
  // KB uses this to recommend hook strategies for new episodes.
  const publishedWithScores = (recentEpisodes || []).filter(e =>
    e.status === 'published' && e.yt_retention_score > 0 && e.generation_decisions?.hookType
  )
  if (publishedWithScores.length) {
    const hookMap = {}
    for (const ep of publishedWithScores) {
      const hookType = ep.generation_decisions.hookType
      if (!hookMap[hookType]) hookMap[hookType] = []
      hookMap[hookType].push(ep.yt_retention_score)
    }
    const hookSummary = Object.entries(hookMap)
      .map(([type, scores]) => {
        const avg = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
        return { type, avg, count: scores.length }
      })
      .sort((a, b) => b.avg - a.avg)

    sections.push(`## HOOK PERFORMANCE (${publishedWithScores.length} published episodes)
What hook types work for this channel — use this to guide new episode hooks:
${hookSummary.map(h => `${h.type}: avg ${h.avg}/100 retention (${h.count} ep${h.count > 1 ? 's' : ''})`).join('\n')}
Best performing hook: ${hookSummary[0]?.type || 'unknown'}. Lead new episodes with this style unless the topic demands otherwise.`)
  }

  // ── COMPETITOR INTELLIGENCE ───────────────────────────────
  const competitorIntel = category.competitor_intel
  if (competitorIntel?.summary) {
    const ci = competitorIntel
    sections.push(`## COMPETITOR INTELLIGENCE (researched ${ci.researchedAt ? new Date(ci.researchedAt).toLocaleDateString() : 'recently'})
${ci.summary}${ci.contentGaps?.length ? `
Content gaps competitors are missing: ${ci.contentGaps.slice(0, 3).join(' | ')}` : ''}${ci.topPerformingFormats?.length ? `
Top performing formats in niche: ${ci.topPerformingFormats.slice(0, 3).join(' | ')}` : ''}`)
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
  `Ep ${e.episode_number ? e.episode_number + ': ' : ''}"${e.track_name}" [${e.status}] — ${e.summary || ''}${e.themes?.length ? ` | themes: ${e.themes.join(', ')}` : ''}${e.thumbnail_concept ? `\n  Thumbnail: ${e.thumbnail_concept}` : ''}`
).join('\n')}
These are committed from previous KB conversations — the creator plans to record these.`)
  }

  // ── STORYBOARD FRAMES (current episode shot list) ───────────
  // Only included when there's an active storyboard for the episode in context,
  // or when in storyboard mode. Gives KB the actual shot list to comment on.
  if (storyboardFrames?.length) {
    sections.push(`## CURRENT STORYBOARD (active shot list)
${storyboardFrames.map((f, i) =>
  `Shot ${f.position + 1} [${f.shot_type?.toUpperCase()}] ${f.section ? `— ${f.section}` : ''}
  Capture: ${f.description}
  Notes: ${f.notes || 'none'}${f.matched_clip ? `
  Matched clip: ${f.matched_clip.filename}` : ' (no clip matched yet)'}`
).join('

')}`)
  }

  // ── FULL VAULT (all unused ideas, not just favourites) ────
  if (fullVault?.length) {
    const byType = {}
    for (const v of fullVault) {
      if (!byType[v.type]) byType[v.type] = []
      byType[v.type].push(v)
    }
    const vaultSections = Object.entries(byType).map(([type, items]) =>
      `${type.toUpperCase()} (${items.length}):
${items.slice(0, 8).map(v =>
        `  "${v.title}" — ${v.content.slice(0, 120)}${v.content.length > 120 ? '...' : ''}${v.is_favourite ? ' ★' : ''}`
      ).join('
')}`
    ).join('

')

    sections.push(`## VAULT — all unused ideas
${vaultSections}
★ = favourited. When surfacing vault ideas, prioritise starred items and those that match the current episode theme or audience pain point.`)
  }

  // ── RETENTION INSIGHTS (per-video drop-off patterns) ─────
  if (retentionInsights?.length) {
    const insightLines = retentionInsights.slice(0, 5).map(ep => {
      let curveStr = ''
      if (ep.retention_curve_map && typeof ep.retention_curve_map === 'object') {
        const entries = Object.entries(ep.retention_curve_map)
          .map(([sec, pct]) => ({ sec: parseInt(sec), pct: parseFloat(pct) }))
          .sort((a, b) => a.sec - b.sec)
        if (entries.length) {
          const drops = []
          for (let i = 1; i < entries.length; i++) {
            const drop = entries[i-1].pct - entries[i].pct
            if (drop >= 5) {
              const m = Math.floor(entries[i].sec / 60)
              const s = entries[i].sec % 60
              drops.push(`${m}:${String(s).padStart(2,'0')} (${drop.toFixed(0)}% drop)`)
            }
          }
          const keyPoints = entries
            .filter((_, i) => i === 0 || i === entries.length-1 || i % Math.max(1, Math.floor(entries.length/6)) === 0)
            .map(e => {
              const m = Math.floor(e.sec/60), s = e.sec%60
              return `${m}:${String(s).padStart(2,'0')}=${Math.round(e.pct)}%`
            }).join(' -> ')
          curveStr = `\n  Curve: ${keyPoints}${drops.length ? `\n  Biggest drops: ${drops.slice(0,3).join(', ')}` : ''}`
        }
      }
      const patStr = ep.retention_patterns ? `\n  Patterns: ${JSON.stringify(ep.retention_patterns).slice(0,200)}` : ''
      return `"${ep.track_name}" (Ep ${ep.episode_number || '?'}) — score: ${ep.yt_retention_score}/100${curveStr}${patStr}`
    }).join('\n\n')

    sections.push(`## RETENTION PATTERNS (per-episode drop-off data)
These are real retention curves from published episodes. Reference specific timecodes when suggesting script or edit changes.
${insightLines}`)
  }

  // ── SOUND LIBRARY ─────────────────────────────────────────
  if (soundLibrary?.assets?.length) {
    const lib = soundLibrary
    sections.push(`## SOUND LIBRARY (${lib.total} assets across ${lib.libraries?.length || 0} libraries)
${lib.assets.slice(0, 20).map(a =>
  `[${a.category || 'misc'}] "${a.name}"${a.bpm ? ` — ${a.bpm}BPM` : ''}${a.energy_level ? `, energy: ${a.energy_level}` : ''}${a.duration_ms ? `, ${Math.round(a.duration_ms/1000)}s` : ''}`
).join('
')}
In sound mode, reference these by name when suggesting placements.`)
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
CRITICAL FORMATTING RULE: Never use markdown symbols. No bold, no italic, no headers, no bullet points, no backticks, no dividers. Plain prose only. Line breaks between paragraphs are fine.
Keep responses SHORT — max 4-6 sentences for chat, more only when writing actual content.
No bullet lists unless asked. No preamble. Lead with the actual insight or idea.
Do not explain your reasoning unless asked. Just give the answer.

AUDIENCE AWARENESS: You have the creator audience data under YOUR AUDIENCE. Use it actively.
Every hook you suggest should target their specific viewer pain point or aspiration.
Every script should feel made for that exact person, not a generic audience.
When recommending thumbnails, titles, or hooks — reference what actually triggers clicks for this audience.
When audience data is missing, say so and ask the creator to run Gemini research or upload their data.`

  const instructions = {
    generate: base + `
In generate mode: help develop episode ideas targeted at the creator specific audience. Before suggesting a hook or concept, ask: would this stop their specific viewer mid-scroll? Write in the creator voice. Do not think out loud — just produce.`,

    vault: base + `
In vault mode: surface ideas from their library. Cross-reference with the audience model — which ideas match what their viewers are searching for right now?`,

    series: base + `
In series mode: think like a showrunner who knows the audience deeply. Spot narrative threads that resonate with the core pain point and aspiration. Build callback opportunities that reward loyal viewers.`,

    analytics: base + `
In analytics mode: interpret numbers through the audience lens. Why did this video underperform for this specific audience? What does the retention curve say about where their attention breaks? Give 1-2 concrete next steps.`,

    teleprompter: base + `
In teleprompter mode: flag lines that sound written not spoken. Also flag anything that talks at the audience instead of to them. The viewer pain point and aspiration should be felt in the script.`,

    sound: base + `
In sound mode: give precise sound design direction. Consider the emotional state of the audience when watching. BPM, texture, timecode.`,

    editor: base + `
In editor mode: help with clip selection and edit structure. Think about where this specific audience attention breaks — their average retention pattern should inform every cut decision.`,

    storyboard: base + `
In storyboard mode: suggest shot types and framing with the audience in mind. The thumbnail frame should be emotionally targeted to what makes this specific viewer click.`,
  }

  return instructions[mode] || instructions.generate
}
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
    .select('episode_number, track_name, track_context, summary, themes, status, thumbnail_concept')
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

// ── ACTIVE EPISODE FETCHER ───────────────────────────────────────────────────
// Fetches the full episode the creator has open right now.
// Mode-aware: teleprompter gets full VO script, storyboard gets frames,
// analytics gets retention curve, generate gets concept + decisions.

async function getActiveEpisode(episodeId, userId, mode) {
  try {
    // Base fields always included
    const baseSelect = 'id, episode_number, track_name, status, episode_concept, summary, themes, thumbnail_concept, vo_script, script_score, yt_retention_score, retention_curve_map, generation_decisions'

    const { data: ep } = await supabase
      .from('episodes')
      .select(baseSelect)
      .eq('id', episodeId)
      .eq('user_id', userId)
      .single()

    if (!ep) return null

    // Add storyboard frames if in storyboard mode
    if (mode === 'storyboard') {
      const { data: board } = await supabase
        .from('storyboards')
        .select('id')
        .eq('episode_id', episodeId)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()

      if (board) {
        const { data: frames } = await supabase
          .from('storyboard_frames')
          .select('position, shot_type, description, notes, section')
          .eq('storyboard_id', board.id)
          .order('position', { ascending: true })
          .limit(30)
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
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .order('extracted_at', { ascending: false })
      .limit(20)
    return data || []
  } catch { return [] }
}

// ── SCHEDULE FETCHER ─────────────────────────────────────────────────────────

async function getScheduleInfo(userId, categoryId) {
  try {
    const { data: episodes } = await supabase
      .from('episodes')
      .select('episode_number, track_name, status, published_at')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(20)

    const published = episodes || []
    if (published.length === 0) return { publishedCount: 0 }

    const dates  = published.map(e => new Date(e.published_at).getTime())
    const gaps   = []
    for (let i = 0; i < dates.length - 1; i++) {
      gaps.push((dates[i] - dates[i+1]) / 86400000)
    }

    const avgGapDays  = gaps.length ? Math.round(gaps.reduce((s,g) => s+g, 0) / gaps.length) : null
    const daysSince   = Math.round((Date.now() - dates[0]) / 86400000)
    const nextDate    = avgGapDays ? new Date(dates[0] + avgGapDays * 86400000) : null
    const isOverdue   = avgGapDays ? daysSince > avgGapDays * 1.5 : false

    const mean       = avgGapDays || 0
    const variance   = gaps.length ? gaps.reduce((s,g) => s + (g - mean)**2, 0) / gaps.length : 0
    const consistency = Math.max(0, 100 - Math.round(Math.sqrt(variance) * 5))

    return {
      publishedCount:  published.length,
      avgGapDays,
      daysSinceLast:   daysSince,
      lastPublished:   published[0].published_at,
      lastEpName:      published[0].track_name,
      nextRecommended: nextDate?.toISOString() || null,
      isOverdue,
      consistency,
    }
  } catch { return null }
}

// ── SERIES BIBLE + DAILY BRIEF FETCHERS ─────────────────────────────────────

async function getSeriesBible(userId, categoryId) {
  try {
    // Read cached bible from category — don't regenerate here,
    // that's triggered from the SeriesBiblePage or on episode publish
    const { data } = await supabase
      .from('categories')
      .select('series_bible, series_bible_at')
      .eq('id', categoryId)
      .eq('user_id', userId)
      .single()
    if (!data?.series_bible) return null
    return { ...data.series_bible, cachedAt: data.series_bible_at }
  } catch { return null }
}

async function getDailyBrief(userId, categoryId) {
  try {
    // Read from in-memory brief cache via the service
    // Import here to avoid circular deps at module load time
    const { generateDailyBrief } = require('./dailyBrief')
    const brief = await generateDailyBrief(userId, categoryId)
    return brief
  } catch { return null }
}

// ── HIGH VALUE FETCHERS ──────────────────────────────────────────────────────

async function getStoryboardFrames(userId, categoryId) {
  try {
    // Get the most recently updated storyboard for this category
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
      .select(`
        position, shot_type, section, description, notes,
        matched_clip:clip_index(filename, transcript)
      `)
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
      .is('used_at', null)              // only unused ideas
      .order('is_favourite', { ascending: false })  // starred first
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

// ── MEDIUM VALUE FETCHERS ─────────────────────────────────────────────────────

async function getSoundLibrary(userId) {
  try {
    // Get libraries for this user
    const { data: libraries } = await supabase
      .from('sound_libraries')
      .select('id, name')
      .eq('user_id', userId)
      .limit(10)

    if (!libraries?.length) return null

    // Get assets across all libraries
    const { data: assets, count } = await supabase
      .from('sound_assets')
      .select('name, category, bpm, energy_level, duration_ms, use_count', { count: 'exact' })
      .in('library_id', libraries.map(l => l.id))
      .order('use_count', { ascending: false })
      .limit(40)

    return { libraries, assets: assets || [], total: count || 0 }
  } catch { return null }
}

async function getReactionImages(userId, categoryId) {
  try {
    const { data } = await supabase
      .from('creator_assets')
      .select('tag, file_name, storage_url')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .eq('asset_type', 'reaction')
      .order('created_at', { ascending: false })
      .limit(20)
    return data || []
  } catch { return [] }
}

async function getAudienceUploads(userId, categoryId) {
  try {
    const { data } = await supabase
      .from('audience_uploads')
      .select('file_name, row_count, persona_summary, upload_date')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .order('upload_date', { ascending: false })
      .limit(5)
    return data || []
  } catch { return [] }
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

module.exports = { assembleContext, invalidateContext };