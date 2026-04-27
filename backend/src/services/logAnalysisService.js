// backend/src/services/logAnalysisService.js
// Analyses the generation log to find what structural decisions
// actually correlate with retention for a specific user's audience.

require('dotenv').config();
const Anthropic  = require('@anthropic-ai/sdk');
const { supabase } = require('../utils/supabase');

const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Run Claude correlation analysis on all logged episodes with performance data.
 * Saves insights back to each log entry and to the category.
 */
async function runLogAnalysis(userId, categoryId) {
  // Get all log entries with performance data
  const { data: logs } = await supabase
    .from('generation_log')
    .select('*')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .not('performance', 'is', null)
    .order('generated_at', { ascending: true });

  if (!logs?.length || logs.length < 3) {
    console.log('[logAnalysis] Not enough data yet (need 3+)');
    return null;
  }

  console.log(`[logAnalysis] Analysing ${logs.length} episodes for user ${userId}`);

  const summary = logs.map(l => ({
    episode:        l.episode_slug,
    retentionScore: l.performance?.ytScore || l.performance?.retentionScore || 0,
    views:          l.performance?.ytViewCount || l.performance?.views || 0,
    hookType:       l.decisions?.hookType       || 'unknown',
    openingClip:    l.decisions?.openingClip    || 'unknown',
    intercutRhythm: l.decisions?.intercutRhythm || 'unknown',
    trendingAngle:  l.decisions?.trendingAngleUsed || 'none',
    reasoning:      l.decisions?.reasoning?.slice(0, 100) || '',
  }));

  let response
  try {
    response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are a YouTube content strategist analysing performance patterns for a solo creator.

Here are ${logs.length} episodes with their structural decisions and retention scores:

${JSON.stringify(summary, null, 2)}

Retention score is 0-100 (higher = better audience retention).

Identify:
1. Which hook types performed best and worst
2. Whether opening on cam vs DAW footage affected retention
3. Which intercut rhythm held viewers longer
4. Whether trending angle injection helped
5. Any surprising correlations
6. THREE specific, actionable recommendations for the next episode

Be specific to THIS creator's data. Do not give generic advice.
Keep the total response under 250 words.`,
    }],
  });

  } catch (err) {
    console.error('[logAnalysis] Anthropic API error:', err.message)
    return null
  }

  const insights = response.content[0].text;

  // Save insights to the most recent log entry
  const latestLog = logs[logs.length - 1];
  await supabase
    .from('generation_log')
    .update({ insights })
    .eq('id', latestLog.id);

  // Also cache in the category for fast context assembly
  await supabase
    .from('categories')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', categoryId);

  console.log(`[logAnalysis] Insights saved for category ${categoryId}`);
  return insights;
}

module.exports = { runLogAnalysis };
