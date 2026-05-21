// backend/src/services/smartScheduler.js
// Smart refresh — fires based on staleness, not just clock time.
// Checks all active categories and refreshes those that need it.
// Also runs the generation log analysis when enough new data exists.

require('dotenv').config();
const cron     = require('node-cron');
const { supabase } = require('../utils/supabase');
const { refreshCategoryTrending } = require('./trendingService');
const { researchAudience, researchCompetitors } = require('./geminiService');
const pushService = require('./pushService');
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

// Audience research is stale if older than 7 days
function isAudienceResearchStale(category) {
  const updatedAt = category.audience_model?.gemini_updated_at
  if (!updatedAt) return true
  const hoursOld = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60)
  return hoursOld >= 168 // 7 days
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
// Run Gemini audience research for a category and store in audience_model
async function runAudienceResearch(userId, categoryId) {
  const { data: category } = await supabase
    .from('categories')
    .select('niche, audience_model')
    .eq('id', categoryId)
    .eq('user_id', userId)
    .single()

  if (!category) return

  // Pull channel context from latest youtube demographics if available
  const existingModel   = category.audience_model || {}
  const ytDemographics  = existingModel.youtube || {}
  const channelContext  = {
    topCountries:   ytDemographics.geography?.topCountries?.slice(0,3).map(c => c.country) || [],
    avgRetention:   ytDemographics.ageGender ? null : null,
    primaryDevice:  ytDemographics.devices?.[0]?.device || null,
  }

  console.log(`[smartScheduler] Running audience research for category ${categoryId} (${category.niche})`)

  const geminiInsights = await researchAudience(category.niche, channelContext)

  await supabase.from('categories').update({
    audience_model: {
      ...existingModel,
      geminiInsights,
      gemini_updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq('id', categoryId).eq('user_id', userId)

  console.log(`[smartScheduler] Audience research complete for category ${categoryId}`)
}

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

// Audience research sweep — runs weekly, checks all active categories
// Check all active categories for publish overdue — fires weekly push reminders
async function overdueReminderSweep() {
  const { data: categories } = await supabase
    .from('categories')
    .select('id, user_id, name, auto_refresh_enabled')
    .eq('auto_refresh_enabled', true)
    .eq('is_active', true)

  if (!categories?.length) return

  for (const cat of categories) {
    try {
      // Get last published episode
      const { data: lastEp } = await supabase
        .from('episodes')
        .select('published_at, track_name, episode_number')
        .eq('category_id', cat.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1)
        .single()

      if (!lastEp?.published_at) continue
      const daysSince = (Date.now() - new Date(lastEp.published_at).getTime()) / 86400000

      // Push if overdue by more than 3 days beyond typical cadence
      if (daysSince > 10) {
        await pushService.sendToUser(cat.user_id, {
          title: '⏰ Time to publish',
          body:  `You haven't published for ${Math.round(daysSince)} days — KB is ready to help plan your next episode`,
          icon:  '/icons/icon-192x192.png',
          tag:   'overdue-reminder',
          data:  { url: '/', type: 'overdue_reminder' },
          actions: [
            { action: 'open', title: 'Open KB' },
            { action: 'dismiss', title: 'Later' },
          ],
        })
      }
    } catch {}
  }
}

async function audienceResearchSweep() {
  console.log('[smartScheduler] Running audience research sweep...')

  const { data: categories } = await supabase
    .from('categories')
    .select('id, user_id, niche, audience_model, auto_refresh_enabled')
    .eq('auto_refresh_enabled', true)
    .eq('is_active', true)

  if (!categories?.length) return

  let researched = 0
  for (const cat of categories) {
    if (isAudienceResearchStale(cat)) {
      try {
        await runAudienceResearch(cat.user_id, cat.id)
        researched++
      } catch (err) {
        console.warn(`[smartScheduler] Audience research failed for ${cat.id}:`, err.message)
      }
      // Delay between calls to avoid Gemini rate limits
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  console.log(`[smartScheduler] Audience research sweep complete. Researched ${researched}/${categories.length} categories.`)
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

  // Overdue publish reminder — every Wednesday at 9am
  cron.schedule('0 9 * * 3', () => {
    overdueReminderSweep().catch(err => console.error('[smartScheduler] Overdue sweep error:', err.message))
  })

  // Competitor intelligence sweep every Saturday at 2am
  cron.schedule('0 2 * * 6', () => {
    competitorIntelSweep().catch(err => console.error('[smartScheduler] Competitor sweep error:', err.message))
  })

  // Audience research sweep every Sunday at 2am
  cron.schedule('0 2 * * 0', () => {
    audienceResearchSweep().catch(err => console.error('[smartScheduler] Audience research error:', err.message))
  })

  console.log('[smartScheduler] Started. Sweep: every 6h. Analysis: daily 3am. Audience research: weekly Sunday 2am.');
}

// Competitor intelligence sweep — runs weekly, checks all active categories
async function competitorIntelSweep() {
  console.log('[smartScheduler] Running competitor intelligence sweep...')

  const { data: categories } = await supabase
    .from('categories')
    .select('id, user_id, name, niche, competitor_intel, auto_refresh_enabled')
    .eq('auto_refresh_enabled', true)
    .eq('is_active', true)

  if (!categories?.length) return

  let researched = 0
  for (const cat of categories) {
    // Stale after 7 days
    const updatedAt = cat.competitor_intel?.researchedAt
    const hoursOld  = updatedAt
      ? (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60)
      : 9999
    if (hoursOld < 168) continue

    try {
      const intel = await researchCompetitors(cat.niche, cat.name)
      await supabase.from('categories').update({
        competitor_intel: intel,
        updated_at:       new Date().toISOString(),
      }).eq('id', cat.id).eq('user_id', cat.user_id)
      researched++
      console.log(`[smartScheduler] Competitor intel updated for ${cat.name}`)
    } catch (err) {
      console.warn(`[smartScheduler] Competitor intel failed for ${cat.id}:`, err.message)
    }
    await new Promise(r => setTimeout(r, 5000))
  }
  console.log(`[smartScheduler] Competitor sweep done. Updated ${researched}/${categories.length}.`)
}

module.exports = {
  startSmartScheduler,
  checkCategoryStaleness,
  triggerRefresh,
  backgroundSweep,
  runAudienceResearch,
  audienceResearchSweep,
  competitorIntelSweep,
  overdueReminderSweep,
};