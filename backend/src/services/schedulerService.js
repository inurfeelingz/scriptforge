// backend/src/services/schedulerService.js
// Background cron jobs:
//   1. Weekly YouTube analytics auto-pull (Mondays 08:00)
//   2. Publishing schedule reminders — nudges when cadence is slipping
//   3. Invalidates series bible cache when a new episode is published
//
// Started once at server boot via schedulerService.start()

const cron       = require('node-cron')
const { supabase } = require('../utils/supabase')
const pushService  = require('./pushService')
const { invalidateBrief } = require('./dailyBrief')

// ── Start all jobs ────────────────────────────────────────────────────────────

function start() {
  if (!process.env.VAPID_PUBLIC_KEY) {
    console.log('[scheduler] Push notifications not configured — schedule reminders disabled')
  }

  // Weekly YouTube pull — every Monday at 08:00 UTC
  cron.schedule('0 8 * * 1', () => weeklyAnalyticsPull())

  // Publishing cadence check — every day at 09:00 UTC
  cron.schedule('0 9 * * *', () => cadenceReminders())

  // Series bible cache invalidation — every hour, checks for newly published episodes
  cron.schedule('0 * * * *', () => invalidateStaleSeriesBibles())

  console.log('[scheduler] Jobs started: weekly analytics pull, daily cadence check, hourly bible invalidation')
}

// ── Weekly YouTube analytics pull ────────────────────────────────────────────

async function weeklyAnalyticsPull() {
  console.log('[scheduler] Starting weekly YouTube analytics pull')

  const { data: connections } = await supabase
    .from('youtube_connections')
    .select('user_id, category_id, last_pulled_at')

  if (!connections?.length) return
  console.log(`[scheduler] Pulling analytics for ${connections.length} connected accounts`)

  const { getValidToken, pullAnalyticsData } = require('./youtubeOAuth')
  const Anthropic = require('@anthropic-ai/sdk')
  const client    = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const { assembleContext } = require('./contextAssembler')

  for (const conn of connections) {
    try {
      const accessToken = await getValidToken(conn.user_id, conn.category_id)
      const videos      = await pullAnalyticsData(accessToken)
      if (!videos.length) continue

      const calcScore = (pct, views, ctr) => {
        const p = Math.min(pct || 0, 100) * 0.5
        const v = Math.min(Math.log10(Math.max(views || 1, 1)) / 6, 1) * 100 * 0.3
        const c = Math.min((ctr || 0) * 20, 100) * 0.2
        return Math.round(p + v + c)
      }

      const scored = videos.map(v => ({ ...v, retentionScore: calcScore(v.avgViewPercentage, v.views, v.ctr || 0) }))
        .sort((a, b) => b.retentionScore - a.retentionScore)

      const avgScore = Math.round(scored.reduce((s, v) => s + v.retentionScore, 0) / scored.length)

      // Quick insight generation
      const context = await assembleContext(conn.user_id, conn.category_id, { mode: 'analytics' })
      const topTitles = scored.slice(0, 5).map((v, i) =>
        `${i + 1}. "${v.title}" — score: ${v.retentionScore}`
      ).join('\n')

      const insightRes = await client.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: context,
        messages: [{ role: 'user', content: `Weekly analytics update. Top 5:\n${topTitles}\n\nOne-sentence key insight for this creator.` }],
      })

      const insights = insightRes.content[0].text

      await supabase.from('analytics_uploads').insert({
        user_id:        conn.user_id,
        category_id:    conn.category_id,
        platform:       'youtube',
        source:         'oauth_weekly',
        video_count:    videos.length,
        avg_score:      avgScore,
        top_performers: scored.slice(0, 20),
        insights,
        raw_data:       scored,
      })

      await supabase.from('youtube_connections').update({
        last_pulled_at: new Date().toISOString(),
      }).eq('user_id', conn.user_id).eq('category_id', conn.category_id)

      // Match episodes
      let matched = 0
      for (const video of scored.slice(0, 30)) {
        const { data: eps } = await supabase.from('episodes')
          .select('id')
          .eq('user_id', conn.user_id)
          .eq('category_id', conn.category_id)
          .ilike('track_name', `%${video.title.slice(0, 20)}%`)
        if (eps?.length) {
          for (const ep of eps) {
            await supabase.from('episodes').update({
              yt_retention_score: video.retentionScore,
              yt_view_count:      video.views,
              yt_avg_view_pct:    video.avgViewPercentage,
              performance_logged_at: new Date().toISOString(),
            }).eq('id', ep.id)
            matched++
          }
        }
      }

      // Notify user
      await pushService.sendToUser(
        conn.user_id,
        pushService.weeklyPullPayload(videos.length, matched)
      )

      // Bust daily brief cache — analytics changed
      invalidateBrief(conn.user_id, conn.category_id)

      console.log(`[scheduler] Pulled ${videos.length} videos for user ${conn.user_id}, matched ${matched} episodes`)
    } catch (err) {
      console.error(`[scheduler] Pull failed for user ${conn.user_id}:`, err.message)
    }
  }
}

// ── Publishing cadence reminders ──────────────────────────────────────────────
// Runs daily. Notifies users whose publish cadence is slipping.
// Logic: if their average gap between episodes is X days, and it's been >X*1.5 days
// since the last publish, send a nudge. Don't send more than once every 3 days.

async function cadenceReminders() {
  if (!process.env.VAPID_PUBLIC_KEY) return
  console.log('[scheduler] Checking publishing cadence')

  // Get all users with at least 3 published episodes
  const { data: users } = await supabase
    .from('episodes')
    .select('user_id, category_id')
    .eq('status', 'published')
    .not('published_at', 'is', null)

  if (!users?.length) return

  // Group by user+category
  const groups = {}
  for (const row of users) {
    const key = `${row.user_id}:${row.category_id}`
    groups[key] = groups[key] || { userId: row.user_id, categoryId: row.category_id, count: 0 }
    groups[key].count++
  }

  for (const { userId, categoryId, count } of Object.values(groups)) {
    if (count < 3) continue  // need at least 3 to establish a cadence

    try {
      // Get published episodes sorted by date
      const { data: eps } = await supabase
        .from('episodes')
        .select('published_at, episode_number, track_name')
        .eq('user_id', userId)
        .eq('category_id', categoryId)
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(10)

      if (!eps || eps.length < 3) continue

      // Calculate average gap between last 5 episodes
      const dates = eps.map(e => new Date(e.published_at).getTime()).slice(0, 5)
      const gaps  = []
      for (let i = 0; i < dates.length - 1; i++) {
        gaps.push((dates[i] - dates[i + 1]) / 86400000)
      }
      const avgGapDays = gaps.reduce((s, g) => s + g, 0) / gaps.length
      const daysSinceLast = (Date.now() - dates[0]) / 86400000

      // Slip threshold: 1.5x their normal cadence, minimum 10 days
      const slipThreshold = Math.max(avgGapDays * 1.5, 10)

      if (daysSinceLast < slipThreshold) continue

      // Check if we already sent a reminder recently (within 3 days)
      const { data: recentReminder } = await supabase
        .from('push_notifications_log')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'cadence_reminder')
        .gte('sent_at', new Date(Date.now() - 3 * 86400000).toISOString())
        .limit(1)
        .single()

      if (recentReminder) continue

      // Check if there's an episode ready to edit/publish (more actionable message)
      const { data: readyEp } = await supabase
        .from('episodes')
        .select('episode_number, track_name, status')
        .eq('user_id', userId)
        .eq('category_id', categoryId)
        .in('status', ['ready', 'recorded', 'edited'])
        .order('episode_number', { ascending: false })
        .limit(1)
        .single()

      let message, route
      if (readyEp) {
        const action = readyEp.status === 'ready' ? 'record' : readyEp.status === 'recorded' ? 'edit' : 'publish'
        message = `Ep ${readyEp.episode_number} "${readyEp.track_name}" is waiting to ${action} — ${Math.round(daysSinceLast)} days since your last upload`
        route   = readyEp.status === 'ready' ? '/teleprompter' : readyEp.status === 'edited' ? '/series' : '/editor'
      } else {
        message = `${Math.round(daysSinceLast)} days since your last upload — your usual cadence is every ${Math.round(avgGapDays)} days. Time to generate?`
        route   = '/generate'
      }

      await pushService.sendToUser(userId, pushService.scheduleReminderPayload(message, route))

      // Log the notification so we don't spam
      await supabase.from('push_notifications_log').insert({
        user_id:  userId,
        type:     'cadence_reminder',
        message,
        sent_at:  new Date().toISOString(),
      })

      console.log(`[scheduler] Cadence reminder sent to user ${userId}`)
    } catch (err) {
      console.error(`[scheduler] Cadence check failed for user ${userId}:`, err.message)
    }
  }
}

// ── Invalidate stale series bibles ────────────────────────────────────────────
// When an episode is published, the series bible needs regeneration.
// We don't regenerate immediately (expensive) — just clear the cache
// so the next page load triggers a fresh build.

async function invalidateStaleSeriesBibles() {
  // Find categories where an episode was published in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: recentPublish } = await supabase
    .from('episodes')
    .select('category_id, user_id')
    .eq('status', 'published')
    .gte('updated_at', oneHourAgo)

  if (!recentPublish?.length) return

  const pairs = [...new Map(recentPublish.map(r => [`${r.user_id}:${r.category_id}`, r])).values()]

  for (const { user_id, category_id } of pairs) {
    await supabase
      .from('categories')
      .update({ series_bible_at: null, updated_at: new Date().toISOString() })
      .eq('id', category_id)
      .eq('user_id', user_id)

    invalidateBrief(user_id, category_id)
  }

  if (pairs.length) {
    console.log(`[scheduler] Invalidated series bible cache for ${pairs.length} categories`)
  }
}

module.exports = { start, weeklyAnalyticsPull, cadenceReminders }
