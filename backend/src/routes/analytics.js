// backend/src/routes/analytics.js
const express = require('express');
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { supabase }        = require('../utils/supabase');
const { assembleContext } = require('../services/contextAssembler');

const router  = express.Router();
const client  = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
    const csvText = req.file.buffer.toString('utf8');

    // Validate column headers before processing
    const firstLine    = csvText.trim().split('\n')[0]?.toLowerCase() || ''
    const hasVideoData = firstLine.includes('title') || firstLine.includes('video')

    if (!hasVideoData) {
      return res.status(400).json({
        error: 'CSV format not recognised. ' +
               (platform === 'youtube'
                 ? 'Export from YouTube Studio → Analytics → Content → See more → Export current view'
                 : 'Export from TikTok Creator Center → Analytics → Content → Export'),
        tip:   'The file must contain video title and view data.',
      })
    }

    // For YouTube: check it's the right report type (needs "average view percentage")
    if (platform === 'youtube' && !firstLine.includes('view percentage') && !firstLine.includes('watch') && !firstLine.includes('views')) {
      return res.status(400).json({
        error: 'This looks like the wrong YouTube export. Need the Content report with Average View Percentage column.',
        tip:   'In YouTube Studio: Analytics → Content tab → Export',
      })
    }

    // Parse CSV based on platform
    const videos = platform === 'youtube'
      ? parseYouTubeCSV(csvText)
      : parseTikTokCSV(csvText);

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
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system:     context,
      messages: [{
        role: 'user',
        content: `Interpret this ${platform} analytics data for the creator.

TOP 10 PERFORMERS:
${topTitles}

TOTALS: ${videos.length} videos, avg score: ${Math.round(scored.reduce((s,v) => s+v.retentionScore,0)/scored.length)}

Give 3-4 specific, actionable insights. Reference episode titles where relevant. End with 2 concrete recommendations for the next episode structure.`,
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
  const lines  = csv.trim().split('\n');
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = parseCSVLine(line);
    const row  = {};
    header.forEach((h, i) => { row[h] = cols[i] || ''; });
    return {
      platform:          'youtube',
      title:             row['video title'] || row['title'] || '',
      videoId:           row['video id'] || '',
      views:             parseInt(row['views'] || '0'),
      avgViewPercentage: parseFloat(row['average view percentage'] || '0'),
      avgViewDuration:   row['average view duration'] || '',
      ctr:               parseFloat(row['impressions click-through rate (%)'] || '0'),
    };
  }).filter(v => v.title);
}

function parseTikTokCSV(csv) {
  const lines  = csv.trim().split('\n');
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = parseCSVLine(line);
    const row  = {};
    header.forEach((h, i) => { row[h] = cols[i] || ''; });
    return {
      platform:      'tiktok',
      title:         row['video title'] || row['title'] || '',
      videoId:       row['video id'] || '',
      views:         parseInt(row['views'] || row['video views'] || '0'),
      likes:         parseInt(row['likes'] || '0'),
      fullWatchRate: parseFloat(row['full video watch rate'] || row['finish rate'] || '0'),
    };
  }).filter(v => v.title);
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

module.exports = router;
