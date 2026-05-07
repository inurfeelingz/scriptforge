// backend/src/services/smartScheduler.js
// Smart refresh — fires based on staleness, not just clock time.
// Checks all active categories and refreshes those that need it.
// Also runs the generation log analysis when enough new data exists.

require('dotenv').config();
const cron     = require('node-cron');
const { supabase } = require('../utils/supabase');
const { refreshCategoryTrending } = require('./trendingService');
const { runLogAnalysis }          = require('./logAnalysisService');

/**
 * Check if a category's trending data is stale.
 * Returns true if it needs a refresh.
 */
async function isTrendingStale(category) {
  if (!category.trending_refreshed_at) return true;
  const refreshedAt = new Date(category.trending_refreshed_at);
  const hoursOld    = (Date.now() - refreshedAt.getTime()) / (1000 * 60 * 60);
  return hoursOld >= (category.refresh_interval_hours || 48);
}

/**
 * Check staleness for a specific category — called when user opens app or switches category.
 * Returns { stale: boolean, hoursOld: number }
 */
async function checkCategoryStaleness(categoryId) {
  const { data: category } = await supabase
    .from('categories')
    .select('trending_refreshed_at, refresh_interval_hours, niche')
    .eq('id', categoryId)
    .single();

  if (!category) return { stale: false, hoursOld: 0 };

  const stale = await isTrendingStale(category);
  const hoursOld = category.trending_refreshed_at
    ? Math.round((Date.now() - new Date(category.trending_refreshed_at).getTime()) / (1000 * 60 * 60))
    : 999;

  return { stale, hoursOld, niche: category.niche };
}

/**
 * Trigger an immediate refresh for a category.
 * Called on app-open (if stale) or category-switch.
 */
async function triggerRefresh(userId, categoryId, trigger = 'manual') {
  const { data: category } = await supabase
    .from('categories')
    .select('niche, auto_refresh_enabled')
    .eq('id', categoryId)
    .eq('user_id', userId)
    .single();

  if (!category) return { success: false, error: 'Category not found' };

  const start = Date.now();
  try {
    await refreshCategoryTrending(userId, categoryId, category.niche);

    // Log the refresh
    await supabase.from('refresh_log').insert({
      user_id:      userId,
      category_id:  categoryId,
      refresh_type: 'trending',
      trigger,
      duration_ms:  Date.now() - start,
      success:      true,
    });

    return { success: true, trigger };
  } catch (err) {
    await supabase.from('refresh_log').insert({
      user_id:       userId,
      category_id:   categoryId,
      refresh_type:  'trending',
      trigger,
      duration_ms:   Date.now() - start,
      success:       false,
      error_message: err.message,
    });
    return { success: false, error: err.message };
  }
}

/**
 * Background sweep — check all active categories across all users.
 * Refresh any that are stale and have auto_refresh_enabled.
 * Run every 6 hours via cron.
 */
async function backgroundSweep() {
  console.log('[smartScheduler] Running background staleness sweep...');

  const { data: categories } = await supabase
    .from('categories')
    .select('id, user_id, niche, trending_refreshed_at, refresh_interval_hours, auto_refresh_enabled')
    .eq('auto_refresh_enabled', true)
    .eq('is_active', true);

  if (!categories?.length) return;

  let refreshed = 0;
  for (const cat of categories) {
    if (await isTrendingStale(cat)) {
      await triggerRefresh(cat.user_id, cat.id, 'scheduled');
      refreshed++;
      // Small delay to avoid hammering YouTube API
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`[smartScheduler] Sweep complete. Refreshed ${refreshed}/${categories.length} categories.`);
}

/**
 * Generation log analysis sweep.
 * For each user with 3+ new performance data points since last analysis,
 * run Claude correlation analysis and update insights.
 */
async function analysisSwitch() {
  console.log('[smartScheduler] Checking generation logs for analysis...');

  // Find users with unanalysed performance data
  const { data: logs } = await supabase
    .from('generation_log')
    .select('user_id, category_id')
    .not('performance', 'is', null)
    .is('insights', null)
    .order('generated_at', { ascending: false });

  if (!logs?.length) return;

  // Group by user+category
  const groups = {};
  logs.forEach(l => {
    const key = `${l.user_id}:${l.category_id}`;
    groups[key] = (groups[key] || 0) + 1;
  });

  for (const [key, count] of Object.entries(groups)) {
    if (count >= 3) {
      const [userId, categoryId] = key.split(':');
      try {
        await runLogAnalysis(userId, categoryId);
        console.log(`[smartScheduler] Analysis complete for ${key}`);
      } catch (err) {
        console.warn(`[smartScheduler] Analysis failed for ${key}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

/**
 * Start all scheduled jobs.
 */
function startSmartScheduler() {
  // Background staleness sweep every 6 hours
  cron.schedule('0 */6 * * *', () => {
    backgroundSweep().catch(err => console.error('[smartScheduler] Sweep error:', err.message));
  });

  // Monthly usage + credit reset — runs at midnight on the 1st of each month
  cron.schedule('0 0 1 * *', () => {
    supabase.rpc('reset_monthly_usage')
      .then(() => console.log('[smartScheduler] Monthly usage counters reset'))
      .catch(err => console.error('[smartScheduler] Usage reset failed:', err.message))

    // Reset monthly credits via creditManager
    const { resetMonthlyCredits } = require('./creditManager').default || require('../utils/creditManager')
    resetMonthlyCredits()
      .then(() => console.log('[smartScheduler] Monthly credits reset'))
      .catch(err => console.error('[smartScheduler] Credit reset failed:', err.message))
  })

  // Generation log analysis every day at 3am
  cron.schedule('0 3 * * *', () => {
    analysisSwitch().catch(err => console.error('[smartScheduler] Analysis error:', err.message));
  });

  console.log('[smartScheduler] Started. Sweep: every 6h. Analysis: daily 3am.');
}

module.exports = {
  startSmartScheduler,
  checkCategoryStaleness,
  triggerRefresh,
  backgroundSweep,
};