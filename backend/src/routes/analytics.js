// backend/src/routes/analytics.js
const express = require('express');
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { supabase }        = require('../utils/supabase');
const { assembleContext } = require('../services/contextAssembler');
const ytOAuth             = require('../services/youtubeOAuth');

const router  = express.Router();
const client  = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── YOUTUBE OAUTH: CONNECTION STATUS ─────────────────────────────────────────

router.get('/youtube/status', async (req, res) => {
  const { categoryId } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })
  try {
    const status = await ytOAuth.getConnectionStatus(req.user.id, categoryId)
    res.json(status)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── YOUTUBE OAUTH: CONNECT ───────────────────────────────────────────────────
// Temporary debug — remove after YouTube is working
router.get('/youtube/debug', async (req, res) => {
  res.json({
    hasClientId:     !!process.env.YOUTUBE_CLIENT_ID,
    hasClientSecret: !!process.env.YOUTUBE_CLIENT_SECRET,
    hasRedirectUri:  !!process.env.YOUTUBE_REDIRECT_URI,
    redirectUri:     process.env.YOUTUBE_REDIRECT_URI,
    clientIdPrefix:  process.env.YOUTUBE_CLIENT_ID?.slice(0, 8),
  })
})

// GET /api/analytics/youtube/connect?categoryId=xxx
// Redirects to Google consent screen.
// Accepts token as query param since this is a browser redirect (no auth header possible)

router.get('/youtube/connect', async (req, res) => {
  const { categoryId, token } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  // Auth: accept Bearer header OR token query param (needed for browser redirects)
  if (!req.user) {
    const t = token || req.headers.authorization?.replace('Bearer ', '')
    if (!t) return res.status(401).json({ error: 'Missing or invalid authorization header' })
    const { createClient } = require('@supabase/supabase-js')
    const sc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const { data: { user }, error } = await sc.auth.getUser(t)
    if (error || !user) return res.status(401).json({ error: 'Invalid token' })
    req.user = user
  }

  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return res.status(503).json({
      error: 'YouTube OAuth not configured — add YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI to Railway environment variables',
    })
  }

  // Embed userId so we can verify in callback
  const state  = Buffer.from(JSON.stringify({ userId: req.user.id, categoryId })).toString('base64url')
  const url    = ytOAuth.buildAuthUrl(req.user.id, categoryId)
  res.redirect(url)
})

// ─── YOUTUBE OAUTH: CALLBACK ──────────────────────────────────────────────────
// GET /api/analytics/youtube/callback?code=xxx&state=xxx
// Called by Google after user grants consent.
// Exchanges code, stores tokens, redirects to frontend analytics page.

router.get('/youtube/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query

  if (oauthError) {
    return res.redirect(`${process.env.FRONTEND_URL}/analytics?error=youtube_denied`)
  }

  let userId, categoryId
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    userId     = decoded.userId
    categoryId = decoded.categoryId
  } catch {
    return res.redirect(`${process.env.FRONTEND_URL}/analytics?error=invalid_state`)
  }

  try {
    const tokens  = await ytOAuth.exchangeCode(code)
    await ytOAuth.storeTokens(userId, categoryId, tokens)

    // Get channel info and store it
    const channel = await ytOAuth.getChannelInfo(tokens.access_token)
    if (channel) {
      await supabase.from('youtube_connections').update({
        channel_id:        channel.channelId,
        channel_title:     channel.title,
        channel_thumbnail: channel.thumbnail,
      }).eq('user_id', userId).eq('category_id', categoryId)
    }

    res.redirect(`${process.env.FRONTEND_URL}/analytics?youtube=connected&categoryId=${categoryId}`)
  } catch (err) {
    console.error('[youtube/callback]', err.message)
    res.redirect(`${process.env.FRONTEND_URL}/analytics?error=oauth_failed`)
  }
})

// ─── YOUTUBE OAUTH: PULL LATEST DATA ─────────────────────────────────────────
// POST /api/analytics/youtube/pull
// Body: { categoryId }
// Fetches latest 90-day analytics, runs through the same Claude pipeline as CSV upload.

router.post('/youtube/pull', async (req, res) => {
  const { categoryId } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  try {
    const accessToken = await ytOAuth.getValidToken(req.user.id, categoryId)
    const videos      = await ytOAuth.pullAnalyticsData(accessToken)

    if (!videos.length) {
      return res.json({ message: 'No video data found for this channel', videoCount: 0 })
    }

    // Score and sort — same logic as CSV upload
    const scored = videos.map(v => ({
      ...v,
      retentionScore: calcScore(v.avgViewPercentage, v.views, v.ctr || 0),
    })).sort((a, b) => b.retentionScore - a.retentionScore)

    // Run Claude insights
    const context   = await assembleContext(req.user.id, categoryId, { mode: 'analytics' })
    const topTitles = scored.slice(0, 10).map((v, i) =>
      `${i+1}. "${v.title}" — score: ${v.retentionScore}, views: ${v.views?.toLocaleString()}, avg view: ${v.avgViewPercentage}%`
    ).join('\n')

    const insightRes = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 600,
      system:     context,
      messages: [{
        role: 'user',
        content: `Interpret this YouTube analytics data (auto-imported via OAuth).\n\nTOP 10 PERFORMERS:\n${topTitles}\n\nTOTALS: ${videos.length} videos, avg score: ${Math.round(scored.reduce((s,v) => s+v.retentionScore,0)/scored.length)}\n\nGive 3-4 specific, actionable insights. Reference episode titles. End with 2 concrete recommendations for the next episode.`,
      }],
    })

    const insights = insightRes.content[0].text
    const avgScore = Math.round(scored.reduce((s,v) => s+v.retentionScore,0) / scored.length)

    // Save
    await supabase.from('analytics_uploads').insert({
      user_id:        req.user.id,
      category_id:    categoryId,
      platform:       'youtube',
      source:         'oauth_auto',
      video_count:    videos.length,
      avg_score:      avgScore,
      top_performers: scored.slice(0, 20),
      insights,
      raw_data:       scored,
    })

    // Update last pulled timestamp
    await supabase.from('youtube_connections').update({
      last_pulled_at: new Date().toISOString(),
    }).eq('user_id', req.user.id).eq('category_id', categoryId)

    // Match episodes
    let matched = 0
    for (const video of scored.slice(0, 30)) {
      const { data: eps } = await supabase
        .from('episodes')
        .select('id')
        .eq('user_id', req.user.id)
        .eq('category_id', categoryId)
        .ilike('track_name', `%${video.title.slice(0, 20)}%`)
      if (eps?.length) {
        for (const ep of eps) {
          await supabase.from('episodes').update({
            yt_view_count:      video.views,
            yt_avg_view_pct:    video.avgViewPercentage,
            yt_retention_score: video.retentionScore,
            performance_logged_at: new Date().toISOString(),
          }).eq('id', ep.id)
          matched++
        }
      }
    }

    res.json({ videoCount: videos.length, avgScore, insights, episodesMatched: matched, source: 'oauth' })
  } catch (err) {
    console.error('[youtube/pull]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── YOUTUBE OAUTH: DISCONNECT ────────────────────────────────────────────────

router.delete('/youtube/disconnect', async (req, res) => {
  const { categoryId } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })
  try {
    await ytOAuth.disconnect(req.user.id, categoryId)
    res.json({ disconnected: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── EPISODE RETENTION CURVE ──────────────────────────────────────────────────
// GET /api/analytics/episode/:id/retention
// Returns the retention curve map + script lines mapped to timecodes
// Used by EpisodeReview page (improvement 10)

router.get('/episode/:id/retention', async (req, res) => {
  const { data: episode, error } = await supabase
    .from('episodes')
    .select('id, episode_number, track_name, vo_script, retention_curve_map, retention_patterns, yt_retention_score')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (error || !episode) return res.status(404).json({ error: 'Episode not found' })

  // Map VO script lines to approximate timecodes
  // Each paragraph ~= speaking time based on word count at 130wpm
  const scriptLines = mapScriptToTimecodes(episode.vo_script || '')

  res.json({
    episode: {
      id:             episode.id,
      episodeNumber:  episode.episode_number,
      trackName:      episode.track_name,
      retentionScore: episode.yt_retention_score,
    },
    retentionCurve:   episode.retention_curve_map || null,
    retentionPatterns: episode.retention_patterns || null,
    scriptLines,
    hasRetentionData: !!episode.retention_curve_map,
  })
})

// ─── RETENTION CURVE INGEST ───────────────────────────────────────────────────
// POST /api/analytics/episode/:id/retention-curve
// Body: { curveData } — raw retention CSV or JSON from YouTube Studio
// Saves the curve and triggers template rebuild

router.post('/episode/:id/retention-curve', async (req, res) => {
  const { curveData } = req.body
  if (!curveData) return res.status(400).json({ error: 'curveData required' })

  try {
    const { parseRetentionCurve, extractStructuralPatterns, saveRetentionCurve } = require('../services/retentionMapper')
    const result = await saveRetentionCurve(req.user.id, req.params.id, curveData)
    res.json({ saved: true, ...result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})



// ─── UPLOAD ANALYTICS CSV ─────────────────────────────────────────────────────

router.post('/upload', upload.single('file'), async (req, res) => {
  const { categoryId, platform } = req.body;

  if (!req.file || !categoryId || !platform) {
    return res.status(400).json({ error: 'file, categoryId, and platform are required' });
  }

  // Validate file type before attempting to parse
  const allowedMimes = ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']
  const fileExt      = (req.file.originalname || '').toLowerCase().split('.').pop()
  if (!allowedMimes.includes(req.file.mimetype) && fileExt !== 'csv' && fileExt !== 'txt') {
    return res.status(400).json({ error: 'File must be a CSV. Export from YouTube Studio or TikTok Creator Center.' })
  }

  try {
    const csvText = req.file.buffer.toString('utf8')
    const firstLine = csvText.trim().split('\n')[0]?.toLowerCase().replace(/"/g, '') || ''

    // Detect format type
    const isYTSummary  = firstLine.includes('content type') || firstLine.includes('watch time')
    const isYTPerVideo = firstLine.includes('video title') || firstLine.includes('average view percentage')
    const isTKOverview = firstLine.includes('date') && firstLine.includes('video views')
    const isTKPerVideo = firstLine.includes('video title') && firstLine.includes('video views')

    // Parse CSV based on platform and detected format
    let videos = []
    let dataType = 'unknown'

    if (platform === 'youtube') {
      if (isYTPerVideo) {
        videos = parseYouTubeCSV(csvText)
        dataType = 'per_video'
      } else if (isYTSummary) {
        videos = parseYouTubeSummaryCSV(csvText)
        dataType = 'summary'
      } else {
        return res.status(400).json({
          error: 'YouTube CSV format not recognised.',
          tip: 'Export from YouTube Studio → Analytics → Content tab → See more → Export current view. Or use the Overview export.',
        })
      }
    } else {
      if (isTKPerVideo) {
        videos = parseTikTokCSV(csvText)
        dataType = 'per_video'
      } else if (isTKOverview) {
        videos = parseTikTokOverviewCSV(csvText)
        dataType = 'overview'
      } else {
        return res.status(400).json({
          error: 'TikTok CSV format not recognised.',
          tip: 'Export from TikTok Creator Center → Analytics → Overview or Content tab → Export.',
        })
      }
    }

    if (!videos.length) {
      return res.status(400).json({ error: 'No valid data found in CSV. Check the file format.' });
    }

    // Calculate scores
    const scored = videos.map(v => ({
      ...v,
      retentionScore: calcScore(v.avgViewPercentage || v.fullWatchRate, v.views, v.ctr || 0),
    })).sort((a, b) => b.retentionScore - a.retentionScore);

    // Claude interprets the data
    const context   = await assembleContext(req.user.id, categoryId, { mode: 'analytics' });
    const topTitles = scored.slice(0, 10).map((v, i) =>
      `${i+1}. "${v.title}" — score: ${v.retentionScore}, views: ${v.views?.toLocaleString()}, avg view: ${v.avgViewPercentage || v.fullWatchRate}%`
    ).join('\n');

    const insightRes = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 600,
      system:     context,
      messages: [{
        role: 'user',
        content: `Interpret this ${platform} analytics data for the creator. Data type: ${dataType}.

TOP PERFORMERS:
${topTitles}

TOTALS: ${videos.length} entries, avg score: ${Math.round(scored.reduce((s,v) => s+v.retentionScore,0)/scored.length)}

Give 3-4 specific, actionable insights based on this data. ${dataType === 'per_video' ? 'Reference video titles where relevant.' : 'Note this is aggregated data, not per-video.'} End with 2 concrete recommendations for the next episode structure.`,
      }],
    });

    const insights = insightRes.content[0].text;
    const avgScore = Math.round(scored.reduce((s,v) => s+v.retentionScore,0) / scored.length);

    // Save to DB
    const { data: upload_record } = await supabase
      .from('analytics_uploads')
      .insert({
        user_id:        req.user.id,
        category_id:    categoryId,
        platform,
        video_count:    videos.length,
        avg_score:      avgScore,
        top_performers: scored.slice(0, 20),
        insights,
        raw_data:       scored,
      })
      .select()
      .single();

    // Auto-match to existing episodes and log performance
    let matched = 0;
    for (const video of scored.slice(0, 30)) {
      const { data: episodes } = await supabase
        .from('episodes')
        .select('id, track_name')
        .eq('user_id', req.user.id)
        .eq('category_id', categoryId)
        .ilike('track_name', `%${video.title.slice(0, 20)}%`);

      if (episodes?.length) {
        for (const ep of episodes) {
          await supabase.from('episodes').update({
            yt_view_count:      platform === 'youtube' ? video.views : null,
            yt_avg_view_pct:    platform === 'youtube' ? video.avgViewPercentage : null,
            yt_retention_score: platform === 'youtube' ? video.retentionScore : null,
            tt_view_count:      platform === 'tiktok'  ? video.views : null,
            tt_full_watch_rate: platform === 'tiktok'  ? video.fullWatchRate : null,
            performance_logged_at: new Date().toISOString(),
          }).eq('id', ep.id);
          matched++;
        }
      }
    }

    res.json({
      uploadId:     upload_record?.id,
      videoCount:   videos.length,
      avgScore,
      topPerformers: scored.slice(0, 5),
      insights,
      episodesMatched: matched,
    });

  } catch (err) {
    console.error('[analytics/upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET ANALYTICS HISTORY ────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { categoryId } = req.query;

  const { data } = await supabase
    .from('analytics_uploads')
    .select('id, platform, upload_date, video_count, avg_score, insights, top_performers')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .order('upload_date', { ascending: false })
    .limit(10);

  res.json({ uploads: data || [] });
});

// ─── CSV PARSERS ──────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = []; let curr = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(curr); curr = ''; }
    else { curr += ch; }
  }
  result.push(curr);
  return result.map(c => c.replace(/"/g, '').trim());
}

function parseYouTubeCSV(csv) {
  const lines  = csv.trim().split('\n')
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase())
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = parseCSVLine(line)
    const row  = {}
    header.forEach((h, i) => { row[h] = cols[i] || '' })
    return {
      platform:          'youtube',
      title:             row['video title'] || row['title'] || '',
      videoId:           row['video id'] || '',
      views:             parseInt(row['views'] || '0'),
      avgViewPercentage: parseFloat(row['average view percentage'] || '0'),
      avgViewDuration:   row['average view duration'] || '',
      ctr:               parseFloat(row['impressions click-through rate (%)'] || '0'),
    }
  }).filter(v => v.title)
}

// YouTube Overview/Summary export — has Content type rows (Total, Shorts, Videos etc)
function parseYouTubeSummaryCSV(csv) {
  const lines  = csv.trim().split('\n')
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase())
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = parseCSVLine(line)
    const row  = {}
    header.forEach((h, i) => { row[h] = cols[i] || '' })
    const type = row['content type'] || row['type'] || 'Unknown'
    if (!type || type.toLowerCase() === 'total') return null
    const views = parseInt((row['views'] || '0').replace(/,/g, ''))
    const watchHours = parseFloat((row['watch time (hours)'] || '0').replace(/,/g, ''))
    // Estimate avg view percentage from watch time / views
    // avg_view_duration_seconds ≈ (watchHours * 3600) / views
    // assume ~60s average video → percentage = duration/60
    const avgDurSecs = views > 0 ? (watchHours * 3600) / views : 0
    const avgViewPct = Math.min(Math.round((avgDurSecs / 60) * 100), 100)
    return {
      platform:          'youtube',
      title:             type,
      views,
      avgViewPercentage: avgViewPct,
      avgViewDuration:   row['average view duration'] || '',
    }
  }).filter(Boolean)
}

function parseTikTokCSV(csv) {
  const lines  = csv.trim().split('\n')
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase())
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = parseCSVLine(line)
    const row  = {}
    header.forEach((h, i) => { row[h] = cols[i] || '' })
    return {
      platform:      'tiktok',
      title:         row['video title'] || row['title'] || '',
      videoId:       row['video id'] || '',
      views:         parseInt((row['views'] || row['video views'] || '0').replace(/,/g, '')),
      likes:         parseInt((row['likes'] || '0').replace(/,/g, '')),
      fullWatchRate: parseFloat(row['full video watch rate'] || row['finish rate'] || '0'),
    }
  }).filter(v => v.title)
}

// TikTok Overview export — daily rows with Date, Video Views, Likes etc
function parseTikTokOverviewCSV(csv) {
  const lines  = csv.trim().split('\n')
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/"/g, ''))
  const rows   = lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = parseCSVLine(line)
    const row  = {}
    header.forEach((h, i) => { row[h] = (cols[i] || '').replace(/"/g, '') })
    return {
      platform: 'tiktok',
      title:    row['date'] || 'Unknown date',
      views:    parseInt(row['video views'] || '0'),
      likes:    parseInt(row['likes'] || '0'),
      comments: parseInt(row['comments'] || '0'),
      shares:   parseInt(row['shares'] || '0'),
      // engagement rate as proxy for watch rate
      fullWatchRate: row['video views'] > 0
        ? Math.min(((parseInt(row['likes']||0) + parseInt(row['comments']||0) + parseInt(row['shares']||0)) / parseInt(row['video views']||1)) * 100, 100)
        : 0,
    }
  }).filter(r => r.views > 0)
  return rows
}

function calcScore(avgPct, views, ctr) {
  const pctScore = Math.min(avgPct || 0, 100) * 0.5;
  const volScore = Math.min(Math.log10(Math.max(views || 1, 1)) / 6, 1) * 100 * 0.3;
  const engScore = Math.min((ctr || 0) * 20, 100) * 0.2;
  return Math.round(pctScore + volScore + engScore);
}


// ─── HOOK PERFORMANCE BREAKDOWN ──────────────────────────────────────────────
// Returns hookType → avg retention score from generation_log + episodes join

router.get('/hook-stats', async (req, res) => {
  const { categoryId } = req.query

  // Join generation_log decisions with episode performance scores
  let query = supabase
    .from('generation_log')
    .select('decisions, episode_id, episodes!inner(yt_retention_score)')
    .eq('user_id', req.user.id)
    .not('episodes.yt_retention_score', 'is', null)

  if (categoryId) query = query.eq('category_id', categoryId)

  const { data, error } = await query.limit(100)
  if (error) return res.status(500).json({ error: error.message })

  // Aggregate by hook type
  const stats = {}
  for (const row of (data || [])) {
    const hookType = row.decisions?.hookType || 'unknown'
    const score    = row.episodes?.yt_retention_score || 0
    if (!stats[hookType]) stats[hookType] = { count: 0, totalScore: 0 }
    stats[hookType].count++
    stats[hookType].totalScore += score
  }

  const breakdown = Object.entries(stats)
    .map(([hookType, s]) => ({
      hookType,
      count:    s.count,
      avgScore: Math.round(s.totalScore / s.count),
    }))
    .sort((a, b) => b.avgScore - a.avgScore)

  res.json({ breakdown, totalEpisodes: data?.length || 0 })
})

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Map VO script paragraphs to approximate timecodes.
 * Uses word count at 130wpm to estimate how far into the episode each line lands.
 * Returns array of { text, startSec, endSec, wordCount, isHint }
 */
function mapScriptToTimecodes(voScript) {
  if (!voScript) return []
  const WPM        = 130
  const WORDS_PER_SEC = WPM / 60

  const lines = voScript.split('\n')
  const result = []
  let elapsedSec = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const isHint    = /^\[(?:CAM|DAW|BROLL|VO)/i.test(trimmed)
    const isTc      = /^\[\d+:\d+\]/.test(trimmed)

    // Extract explicit timecode if present e.g. [0:45]
    if (isTc) {
      const match = trimmed.match(/^\[(\d+):(\d+)\]/)
      if (match) {
        elapsedSec = parseInt(match[1]) * 60 + parseInt(match[2])
      }
    }

    const text      = trimmed.replace(/^\[\d+:\d+\]\s*/, '')
    const wordCount = text.split(/\s+/).filter(Boolean).length
    const durSec    = isHint ? 0 : Math.max(wordCount / WORDS_PER_SEC, 1)

    result.push({
      text,
      startSec:  Math.round(elapsedSec),
      endSec:    Math.round(elapsedSec + durSec),
      wordCount,
      isHint,
      isTc,
    })

    if (!isHint) elapsedSec += durSec
  }

  return result
}

module.exports = router;