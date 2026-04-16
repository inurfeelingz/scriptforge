// backend/src/services/trendingService.js
// Fetches top niche videos from YouTube, transcripts via youtube-transcript,
// then uses Claude to synthesise trending angles for the category.

require('dotenv').config();
const Anthropic  = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
const { supabase } = require('../utils/supabase');

const client  = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });

/**
 * Full trending refresh for a category.
 * Fetches top videos, gets transcripts, Claude synthesises angles.
 * Saves result to categories.trending_data.
 */
async function refreshCategoryTrending(userId, categoryId, niche, count = 20) {
  console.log(`[trendingService] Refreshing: "${niche}" (cat: ${categoryId})`);

  // 1. Fetch top niche videos from YouTube
  const videos = await fetchTopVideos(niche, count);
  console.log(`[trendingService] Fetched ${videos.length} videos`);

  // 2. Get transcripts for top 10
  const withTranscripts = await fetchTranscripts(videos.slice(0, 10));

  // 3. Claude synthesises trending angles
  const analysis = await synthesiseTrending(niche, videos, withTranscripts);

  // 4. Save to category
  await supabase
    .from('categories')
    .update({
      trending_data:         { analysis, videoCount: videos.length, rawTitles: videos.map(v => v.title) },
      trending_refreshed_at: new Date().toISOString(),
    })
    .eq('id', categoryId)
    .eq('user_id', userId);

  console.log(`[trendingService] Done. Themes: ${analysis.themes?.length || 0}`);
  return analysis;
}

async function fetchTopVideos(niche, count) {
  try {
    const res = await youtube.search.list({
      q:                 niche,
      part:              'id,snippet',
      type:              'video',
      order:             'viewCount',
      maxResults:        count,
      videoDuration:     'medium',
      relevanceLanguage: 'en',
      publishedAfter:    new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    return (res.data.items || []).map(item => ({
      videoId:      item.id.videoId,
      title:        item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      publishedAt:  item.snippet.publishedAt,
    }));
  } catch (err) {
    // YouTube API quota exceeded — log clearly and return empty (graceful degradation)
    const isQuota = err.message?.includes('quota') ||
                    err.code === 403 ||
                    err.errors?.[0]?.reason === 'quotaExceeded' ||
                    err.errors?.[0]?.reason === 'dailyLimitExceeded'

    if (isQuota) {
      console.warn('[trendingService] YouTube quota exceeded — trending unavailable today. Resets at midnight PT.')
    } else {
      console.warn('[trendingService] YouTube API error:', err.message)
    }
    return []  // empty array → synthesiseTrending handles gracefully with cached/empty data
  }
}

async function fetchTranscripts(videos) {
  const results = [];
  for (const video of videos) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(video.videoId);
      const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').slice(0, 1500);
      results.push({ ...video, transcript });
    } catch {
      // No captions — skip
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function synthesiseTrending(niche, allVideos, withTranscripts) {
  const titlesText = allVideos.slice(0, 20)
    .map((v, i) => `${i + 1}. "${v.title}" — ${v.channelTitle}`)
    .join('\n');

  const transcriptSample = withTranscripts.slice(0, 5)
    .map(v => `"${v.title}": ${v.transcript?.slice(0, 400) || ''}`)
    .join('\n\n');

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `Analyse trending YouTube content in the "${niche}" niche.

TOP VIDEOS (past 2 weeks):
${titlesText}

TRANSCRIPT SAMPLES:
${transcriptSample}

Return JSON:
{
  "themes": ["3-5 dominant themes creators are covering right now"],
  "recurringHooks": ["3 hook patterns appearing repeatedly"],
  "emergingTopics": ["2-3 sub-topics about to peak"],
  "emotionalTriggers": ["3 emotional angles working now"],
  "avoidAngles": ["1-2 oversaturated angles to avoid"]
}`,
    }],
  });

  try {
    const text = response.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch {
    return {
      themes: [], recurringHooks: [], emergingTopics: [],
      emotionalTriggers: [], avoidAngles: [],
      raw: response.content[0].text,
    };
  }
}

module.exports = { refreshCategoryTrending };
