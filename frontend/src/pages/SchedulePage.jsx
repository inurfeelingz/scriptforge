// frontend/src/pages/SchedulePage.jsx
// Batch 6 — improvement 12:
// Publishing schedule: calendar view, cadence tracking, push notification setup.
// Shows when episodes were published, gaps in the schedule, and next recommended date.
// Push notification management: subscribe, test, unsubscribe.

import { useState, useEffect } from 'react'
import {
  Calendar, Bell, BellOff, Check, RefreshCw, AlertTriangle,
  TrendingUp, Clock, Send, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi } from '../lib/api'
import {
  requestNotificationPermission,
  subscribeToPush, unsubscribeFromPush,
  getPushStatus, sendTestPush, isPushEnabled,
} from '../lib/notifications'
import { getSession } from '../lib/supabase'

// ── Calendar grid ─────────────────────────────────────────────────────────────
function CalendarGrid({ publishedDates, recommendedDate }) {
  const [viewDate, setViewDate] = useState(new Date())
  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const firstDay  = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []

  // Published dates as Set of YYYY-MM-DD strings for fast lookup
  const pubSet = new Set(publishedDates.map(d =>
    new Date(d).toISOString().split('T')[0]
  ))
  const recStr = recommendedDate
    ? new Date(recommendedDate).toISOString().split('T')[0]
    : null
  const todayStr = new Date().toISOString().split('T')[0]

  // Empty leading cells
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const monthName = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  function cellStr(d) {
    if (!d) return null
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className="p-1.5 text-[#444] hover:text-[#888] transition-colors"
        >
          <ChevronLeft size={14}/>
        </button>
        <span className="text-sm font-medium text-[#ccc]">{monthName}</span>
        <button
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="p-1.5 text-[#444] hover:text-[#888] transition-colors"
        >
          <ChevronRight size={14}/>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-[10px] text-[#444] py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const str   = cellStr(d)
          const isPub = str && pubSet.has(str)
          const isRec = str === recStr
          const isToday = str === todayStr
          return (
            <div
              key={i}
              className={`aspect-square flex items-center justify-center text-xs rounded transition-all ${
                !d                 ? ''                                         :
                isPub              ? 'bg-[#c8b89a] text-[#080808] font-bold'   :
                isRec && !isPub    ? 'bg-[#40a060]/20 border border-[#40a060]/40 text-[#40a060]' :
                isToday && !isPub  ? 'border border-[#c8b89a]/30 text-[#c8b89a]' :
                'text-[#555] hover:text-[#888]'
              }`}
            >
              {d}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[10px] flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-[#c8b89a] inline-block"/>
          Published
        </span>
        {recStr && (
          <span className="flex items-center gap-1.5 text-[#40a060]">
            <span className="w-3 h-3 rounded bg-[#40a060]/20 border border-[#40a060]/40 inline-block"/>
            Recommended next
          </span>
        )}
      </div>
    </div>
  )
}

// ── Push notification panel ───────────────────────────────────────────────────
function PushPanel() {
  const { notify } = useStore()
  const [status,    setStatus]    = useState(null)   // null | { active, vapidConfigured, subscriptionCount }
  const [loading,   setLoading]   = useState(true)
  const [toggling,  setToggling]  = useState(false)
  const [testing,   setTesting]   = useState(false)

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    setLoading(true)
    try {
      const session = await getSession()
      const s       = await getPushStatus(session?.access_token)
      setStatus(s)
    } catch {}
    setLoading(false)
  }

  async function handleToggle() {
    setToggling(true)
    try {
      const session = await getSession()
      if (status?.active) {
        await unsubscribeFromPush(session?.access_token)
        setStatus(s => ({ ...s, active: false, subscriptionCount: 0 }))
        notify('Push notifications disabled', 'info')
      } else {
        const granted = await requestNotificationPermission()
        if (!granted) {
          notify('Allow notifications in your browser settings first', 'error')
          setToggling(false)
          return
        }
        const ok = await subscribeToPush(session?.access_token)
        if (ok) {
          setStatus(s => ({ ...s, active: true, subscriptionCount: 1 }))
          notify('Push notifications enabled — you\'ll be reminded when cadence slips', 'success')
        } else {
          notify('Push not available — add VAPID keys to Railway env vars', 'error')
        }
      }
    } catch (err) {
      notify(err.message, 'error')
    }
    setToggling(false)
  }

  async function handleTest() {
    setTesting(true)
    try {
      const session = await getSession()
      await sendTestPush(session?.access_token)
      notify('Test push sent — check your notifications', 'success')
    } catch (err) {
      notify('Test failed: ' + err.message, 'error')
    }
    setTesting(false)
  }

  if (loading) return (
    <div className="h-20 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
  )

  const isActive = status?.active

  return (
    <div className={`border rounded p-4 space-y-3 ${
      isActive ? 'border-[#40a060]/25 bg-[#40a060]/4' : 'border-[#1a1a1a]'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${
          isActive
            ? 'bg-[#40a060]/15 border border-[#40a060]/25'
            : 'bg-[#1a1a1a] border border-[#222]'
        }`}>
          {isActive
            ? <Bell size={14} className="text-[#40a060]"/>
            : <BellOff size={14} className="text-[#555]"/>}
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-[#ccc]">
            {isActive ? 'Push notifications active' : 'Push notifications off'}
          </div>
          <div className="text-xs text-[#555] mt-0.5">
            {!status?.vapidConfigured
              ? 'Requires VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in Railway env vars'
              : isActive
                ? `${status.subscriptionCount} device${status.subscriptionCount !== 1 ? 's' : ''} subscribed — you'll be reminded when your publish cadence slips`
                : 'Enable to get schedule reminders even when the app is closed'}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {isActive && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1a1a1a] text-[#555] rounded text-xs hover:border-[#333] hover:text-[#888] disabled:opacity-40 transition-all"
            >
              {testing ? <RefreshCw size={9} className="animate-spin"/> : <Send size={9}/>}
              Test
            </button>
          )}
          <button
            onClick={handleToggle}
            disabled={toggling || !status?.vapidConfigured}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs disabled:opacity-40 transition-all ${
              isActive
                ? 'border-red-800/40 text-red-400 hover:bg-red-900/10'
                : 'border-[#c8b89a]/25 text-[#c8b89a] bg-[#c8b89a]/8 hover:bg-[#c8b89a]/15'
            }`}
          >
            {toggling
              ? <RefreshCw size={10} className="animate-spin"/>
              : isActive ? <BellOff size={10}/> : <Bell size={10}/>}
            {toggling ? '…' : isActive ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {isActive && (
        <div className="text-[10px] text-[#444] leading-relaxed border-t border-[#1a1a1a] pt-2 mt-1">
          Reminders fire when your publish gap exceeds 1.5× your normal cadence.
          Weekly analytics syncs send a notification when new data is pulled.
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const { activeCategoryId, activeCategory, notify } = useStore()
  const cat = activeCategory?.()

  const [episodes,       setEpisodes]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [cadenceInfo,    setCadenceInfo]    = useState(null)

  useEffect(() => {
    if (!activeCategoryId) {
      setLoading(false)
      return
    }
    setLoading(true)
    episodesApi.list({ categoryId: activeCategoryId, limit: 50 })
      .then(({ episodes: eps }) => {
        setEpisodes(eps || [])
        setCadenceInfo(analyseCadence(eps || []))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [activeCategoryId])

  function analyseCadence(eps) {
    const published = eps
      .filter(e => e.status === 'published' && e.published_at)
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))

    if (published.length < 2) return {
      hasData: false,
      publishedCount: published.length,
      lastPublished: published[0]?.published_at || null,
    }

    const dates = published.map(e => new Date(e.published_at).getTime())
    const gaps  = []
    for (let i = 0; i < dates.length - 1; i++) {
      gaps.push((dates[i] - dates[i + 1]) / 86400000)
    }
    const avgGap      = gaps.reduce((s, g) => s + g, 0) / gaps.length
    const lastPub     = dates[0]
    const daysSince   = (Date.now() - lastPub) / 86400000
    const nextDue     = new Date(lastPub + avgGap * 86400000)
    const isOverdue   = daysSince > avgGap * 1.5
    const daysUntil   = Math.round((nextDue.getTime() - Date.now()) / 86400000)

    // Cadence consistency — stddev of gaps
    const mean = avgGap
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length
    const consistency = Math.max(0, 100 - Math.round(Math.sqrt(variance) * 5))

    return {
      hasData:          true,
      publishedCount:   published.length,
      avgGapDays:       Math.round(avgGap),
      daysSinceLast:    Math.round(daysSince),
      lastPublished:    published[0].published_at,
      lastEpName:       published[0].track_name,
      nextRecommended:  nextDue.toISOString(),
      daysUntilNext:    daysUntil,
      isOverdue,
      consistency,
      publishedDates:   published.map(e => e.published_at),
    }
  }

  const readyEps = episodes.filter(e => e.status === 'ready')
  const inFlight = episodes.filter(e => ['recorded','edited'].includes(e.status))

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Schedule</h1>
        {cat && <p className="text-sm text-[#555] mt-1">{cat.name} · publishing cadence</p>}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
          ))}
        </div>
      ) : (
        <>
          {/* Cadence stats */}
          {cadenceInfo?.hasData ? (
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: 'Avg cadence',
                  value: `Every ${cadenceInfo.avgGapDays}d`,
                  sub:   `${cadenceInfo.publishedCount} published`,
                  color: '#c8b89a',
                },
                {
                  label: 'Days since last',
                  value: `${cadenceInfo.daysSinceLast}d`,
                  sub:   cadenceInfo.isOverdue ? 'Overdue' : 'On track',
                  color: cadenceInfo.isOverdue ? '#e05050' : '#40a060',
                },
                {
                  label: 'Consistency',
                  value: `${cadenceInfo.consistency}%`,
                  sub:   cadenceInfo.consistency >= 80 ? 'Very consistent' : cadenceInfo.consistency >= 60 ? 'Mostly regular' : 'Irregular',
                  color: cadenceInfo.consistency >= 70 ? '#40a060' : '#c8a030',
                },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="bg-[#0a0a0a] border border-[#111] rounded p-4">
                  <div className="text-[10px] text-[#444] uppercase tracking-wide mb-1">{label}</div>
                  <div className="text-xl font-serif" style={{ color }}>{value}</div>
                  <div className="text-[10px] mt-0.5" style={{ color }}>{sub}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-[#1a1a1a] rounded p-4 text-sm text-[#444] text-center">
              Publish at least 2 episodes to see cadence data
            </div>
          )}

          {/* Overdue warning */}
          {cadenceInfo?.isOverdue && (
            <div className="flex items-center gap-3 px-4 py-3 bg-[#2a1000] border border-[#e05050]/20 rounded">
              <AlertTriangle size={14} className="text-[#e05050] shrink-0"/>
              <div className="flex-1 text-sm text-[#e07060]">
                {cadenceInfo.daysSinceLast} days since "{cadenceInfo.lastEpName}" — your usual gap is {cadenceInfo.avgGapDays} days
              </div>
              {readyEps.length > 0 && (
                <a href="/teleprompter"
                  className="text-xs px-3 py-1.5 bg-[#c8b89a]/10 border border-[#c8b89a]/25 text-[#c8b89a] rounded hover:bg-[#c8b89a]/20 transition-all shrink-0">
                  Record now →
                </a>
              )}
            </div>
          )}

          {/* Next recommended date */}
          {cadenceInfo?.hasData && cadenceInfo.daysUntilNext > 0 && !cadenceInfo.isOverdue && (
            <div className="flex items-center gap-3 px-4 py-3 bg-[#40a060]/5 border border-[#40a060]/20 rounded">
              <Check size={13} className="text-[#40a060] shrink-0"/>
              <span className="text-sm text-[#40a060]">
                Next recommended publish: {new Date(cadenceInfo.nextRecommended).toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
                {' '}({cadenceInfo.daysUntilNext > 0 ? `in ${cadenceInfo.daysUntilNext} days` : 'today'})
              </span>
            </div>
          )}

          {/* In-flight episodes */}
          {(readyEps.length > 0 || inFlight.length > 0) && (
            <div className="border border-[#1a1a1a] rounded p-4 space-y-3">
              <div className="text-xs text-[#666] uppercase tracking-wide">In progress</div>
              {[...readyEps, ...inFlight].slice(0, 5).map(ep => (
                <div key={ep.id} className="flex items-center gap-3 text-sm">
                  <span className="text-[10px] font-mono text-[#444] w-6">#{ep.episode_number}</span>
                  <span className="flex-1 text-[#888] truncate">{ep.track_name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border text-[#c8b89a] border-[#c8b89a]/20 capitalize">
                    {ep.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Calendar */}
          {cadenceInfo?.hasData && (
            <div className="border border-[#1a1a1a] rounded p-5">
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={13} className="text-[#555]"/>
                <span className="text-xs text-[#666] uppercase tracking-wide">Publishing calendar</span>
              </div>
              <CalendarGrid
                publishedDates={cadenceInfo.publishedDates}
                recommendedDate={cadenceInfo.isOverdue ? new Date().toISOString() : cadenceInfo.nextRecommended}
              />
            </div>
          )}

          {/* Push notifications */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Bell size={13} className="text-[#555]"/>
              <span className="text-xs text-[#666] uppercase tracking-wide">Schedule reminders</span>
            </div>
            <PushPanel/>
          </div>
        </>
      )}
    </div>
  )
}