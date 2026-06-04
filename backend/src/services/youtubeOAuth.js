// backend/src/services/youtubeOAuth.js
// YouTube Analytics OAuth 2.0 flow.
// Scopes: youtube.readonly + yt-analytics.readonly
//
// Required env vars (Railway):
//   YOUTUBE_CLIENT_ID      — from Google Cloud Console
//   YOUTUBE_CLIENT_SECRET  — from Google Cloud Console
//   YOUTUBE_REDIRECT_URI   — must match exactly: https://your-api.railway.app/api/analytics/youtube/callback
//
// Flow:
//   1. GET  /api/analytics/youtube/connect  → redirects to Google consent screen
//   2. GET  /api/analytics/youtube/callback → exchanges code → stores tokens in DB
//   3. POST /api/analytics/youtube/pull     → fetches latest analytics + imports
//   4. GET  /api/analytics/youtube/status   → checks connection status

const { supabase } = require('../utils/supabase')
const axios        = require('axios')

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ')

// ── Build OAuth URL ───────────────────────────────────────────────────────────

function buildAuthUrl(userId, categoryId) {
  const state  = Buffer.from(JSON.stringify({ userId, categoryId })).toString('base64url')
  const params = new URLSearchParams({
    client_id:     process.env.YOUTUBE_CLIENT_ID,
    redirect_uri:  process.env.YOUTUBE_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',   // get refresh token
    prompt:        'consent',   // force refresh token every time
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// ── Exchange code for tokens ──────────────────────────────────────────────────

async function exchangeCode(code) {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id:     process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    redirect_uri:  process.env.YOUTUBE_REDIRECT_URI,
    grant_type:    'authorization_code',
  })
  return res.data  // { access_token, refresh_token, expires_in, scope }
}

// ── Refresh access token ──────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken) {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: refreshToken,
    client_id:     process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    grant_type:    'refresh_token',
  })
  return res.data  // { access_token, expires_in }
}

// ── Store tokens ──────────────────────────────────────────────────────────────

async function storeTokens(userId, categoryId, tokens) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()

  await supabase.from('youtube_connections').upsert({
    user_id:       userId,
    category_id:   categoryId,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_at:    expiresAt,
    scope:         tokens.scope || SCOPES,
    connected_at:  new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  }, { onConflict: 'user_id,category_id' })
}

// ── Get valid access token (auto-refresh) ─────────────────────────────────────

async function getValidToken(userId, categoryId) {
  const { data, error } = await supabase
    .from('youtube_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .single()

  if (error || !data) throw new Error('YouTube not connected for this category')

  // Refresh if expired (with 5min buffer)
  const expiresAt = new Date(data.expires_at).getTime()
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    if (!data.refresh_token) throw new Error('No refresh token — reconnect YouTube')
    const fresh = await refreshAccessToken(data.refresh_token)
    await supabase.from('youtube_connections').update({
      access_token: fresh.access_token,
      expires_at:   new Date(Date.now() + (fresh.expires_in || 3600) * 1000).toISOString(),
      updated_at:   new Date().toISOString(),
    }).eq('user_id', userId).eq('category_id', categoryId)
    return fresh.access_token
  }

  return data.access_token
}

// ── Get channel info ──────────────────────────────────────────────────────────

async function getChannelInfo(accessToken) {
  const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'snippet,statistics', mine: true },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const channel = res.data.items?.[0]
  return channel ? {
    channelId:   channel.id,
    title:       channel.snippet?.title,
    thumbnail:   channel.snippet?.thumbnails?.default?.url,
    subscribers: channel.statistics?.subscriberCount,
    totalViews:  channel.statistics?.viewCount,
  } : null
}

// ── Pull analytics data ───────────────────────────────────────────────────────
// Fetches last 90 days of video analytics from YouTube Analytics API.
// Returns array of video performance objects ready for the existing CSV pipeline.

async function pullAnalyticsData(accessToken, startDate, endDate) {
  // Step 1: Get channel ID
  const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params:  { part: 'id', mine: true },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const channelId = channelRes.data.items?.[0]?.id
  if (!channelId) throw new Error('No YouTube channel found for this account')

  // Step 2: Get video list (last 50 videos)
  const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    params: {
      part:       'snippet',
      channelId,
      type:       'video',
      order:      'date',
      maxResults: 50,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const videoIds = (videosRes.data.items || []).map(v => v.id?.videoId).filter(Boolean)
  if (!videoIds.length) return []

  // Step 3: Get retention + view stats from Analytics API
  const analyticsRes = await axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
    params: {
      ids:        `channel==${channelId}`,
      startDate:  startDate || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0],
      endDate:    endDate   || new Date().toISOString().split('T')[0],
      metrics:    'views,averageViewPercentage,estimatedMinutesWatched,averageViewDuration',
      dimensions: 'video',
      sort:       '-views',
      maxResults: 50,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const rows    = analyticsRes.data.rows || []
  const headers = (analyticsRes.data.columnHeaders || []).map(h => h.name)

  // Step 4: Get video titles for the IDs we got back
  const titleMap = {}
  if (rows.length) {
    const returnedIds = rows.map(r => r[headers.indexOf('video')]).filter(Boolean).slice(0, 50)
    if (returnedIds.length) {
      const detailRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'snippet', id: returnedIds.join(',') },
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      for (const item of (detailRes.data.items || [])) {
        titleMap[item.id] = item.snippet?.title || item.id
      }
    }
  }

  // Normalise into the same shape the CSV parser returns
  return rows.map(row => {
    const get = (name) => row[headers.indexOf(name)]
    const videoId = get('video') || ''
    return {
      platform:          'youtube',
      title:             titleMap[videoId] || videoId,
      videoId,
      views:             parseInt(get('views') || '0'),
      avgViewPercentage: parseFloat(get('averageViewPercentage') || '0'),
      ctr:               0, // impressionClickThroughRate not available in Analytics API
      avgViewDuration:   get('averageViewDuration') || '',
    }
  }).filter(v => v.title && v.title !== v.videoId)
}

// ── Pull audience demographics ───────────────────────────────────────────────
// Fetches age/gender, geography, traffic sources, and device type.
// All pulled in parallel for efficiency.

async function pullAudienceDemographics(accessToken, startDate, endDate) {
  const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params:  { part: 'id', mine: true },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const channelId = channelRes.data.items?.[0]?.id
  if (!channelId) throw new Error('No YouTube channel found')

  const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
  const end   = endDate   || new Date().toISOString().split('T')[0]

  const base = {
    ids:       `channel==${channelId}`,
    startDate: start,
    endDate:   end,
  }
  const headers = { Authorization: `Bearer ${accessToken}` }

  // Pull all 5 dimensions in parallel
  const [ageGender, geography, trafficSource, deviceType, subStatus] = await Promise.allSettled([

    // Age + gender breakdown
    axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
      params:  { ...base, metrics: 'viewerPercentage', dimensions: 'ageGroup,gender', sort: '-viewerPercentage' },
      headers,
    }),

    // Top 15 countries by views
    axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
      params:  { ...base, metrics: 'views,averageViewPercentage', dimensions: 'country', sort: '-views', maxResults: 15 },
      headers,
    }),

    // Traffic sources
    axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
      params:  { ...base, metrics: 'views,averageViewPercentage', dimensions: 'insightTrafficSourceType', sort: '-views' },
      headers,
    }),

    // Device type
    axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
      params:  { ...base, metrics: 'views,averageViewPercentage', dimensions: 'deviceType', sort: '-views' },
      headers,
    }),

    // Subscriber vs non-subscriber
    axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
      params:  { ...base, metrics: 'views,averageViewPercentage,estimatedMinutesWatched', dimensions: 'subscribedStatus' },
      headers,
    }),
  ])

  // Helper to safely parse a settled result
  const parse = (result) => {
    if (result.status !== 'fulfilled') return []
    const rows    = result.value.data.rows || []
    const headers = (result.value.data.columnHeaders || []).map(h => h.name)
    return rows.map(row => {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = row[i] })
      return obj
    })
  }

  const agGenderRows    = parse(ageGender)
  const geoRows         = parse(geography)
  const trafficRows     = parse(trafficSource)
  const deviceRows      = parse(deviceType)
  const subRows         = parse(subStatus)

  // ── Summarise age + gender ────────────────────────────────────────────────
  const ageGroups = {}
  const genderTotals = {}
  for (const row of agGenderRows) {
    const age    = row.ageGroup    || 'unknown'
    const gender = row.gender      || 'unknown'
    const pct    = parseFloat(row.viewerPercentage || 0)
    ageGroups[age]       = (ageGroups[age]       || 0) + pct
    genderTotals[gender] = (genderTotals[gender] || 0) + pct
  }
  const topAgeGroup = Object.entries(ageGroups).sort((a,b) => b[1]-a[1])[0]

  // ── Summarise geography ───────────────────────────────────────────────────
  const totalGeoViews = geoRows.reduce((s, r) => s + (parseInt(r.views) || 0), 0)
  const topCountries  = geoRows.slice(0, 10).map(r => ({
    country:          r.country,
    views:            parseInt(r.views || 0),
    pct:              totalGeoViews ? Math.round((parseInt(r.views||0)/totalGeoViews)*100) : 0,
    avgViewPct:       parseFloat(r.averageViewPercentage || 0),
  }))

  // ── Summarise traffic sources ─────────────────────────────────────────────
  const totalTrafficViews = trafficRows.reduce((s, r) => s + (parseInt(r.views) || 0), 0)
  const trafficSources    = trafficRows.map(r => ({
    source:     r.insightTrafficSourceType,
    views:      parseInt(r.views || 0),
    pct:        totalTrafficViews ? Math.round((parseInt(r.views||0)/totalTrafficViews)*100) : 0,
    avgViewPct: parseFloat(r.averageViewPercentage || 0),
  }))

  // ── Summarise device type ─────────────────────────────────────────────────
  const totalDeviceViews = deviceRows.reduce((s, r) => s + (parseInt(r.views) || 0), 0)
  const devices          = deviceRows.map(r => ({
    device:     r.deviceType,
    views:      parseInt(r.views || 0),
    pct:        totalDeviceViews ? Math.round((parseInt(r.views||0)/totalDeviceViews)*100) : 0,
    avgViewPct: parseFloat(r.averageViewPercentage || 0),
  }))

  // ── Subscriber vs non-subscriber ──────────────────────────────────────────
  const subData = {}
  for (const row of subRows) {
    subData[row.subscribedStatus] = {
      views:       parseInt(row.views || 0),
      avgViewPct:  parseFloat(row.averageViewPercentage || 0),
      watchMinutes: parseInt(row.estimatedMinutesWatched || 0),
    }
  }

  return {
    pulledAt: new Date().toISOString(),
    ageGender: {
      topAgeGroup:   topAgeGroup?.[0] || 'unknown',
      topAgeGroupPct: Math.round(topAgeGroup?.[1] || 0),
      genderSplit:   genderTotals,
      fullBreakdown: agGenderRows,
    },
    geography: {
      topCountries,
      totalCountries: geoRows.length,
    },
    trafficSources,
    devices,
    subscriberSplit: subData,
  }
}

// ── Check connection status ───────────────────────────────────────────────────

async function getConnectionStatus(userId, categoryId) {
  const { data } = await supabase
    .from('youtube_connections')
    .select('connected_at, expires_at, last_pulled_at, channel_title, channel_thumbnail')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .single()

  if (!data) return { connected: false }

  return {
    connected:       true,
    connectedAt:     data.connected_at,
    lastPulledAt:    data.last_pulled_at,
    channelTitle:    data.channel_title,
    channelThumbnail: data.channel_thumbnail,
    isExpired:       new Date(data.expires_at).getTime() < Date.now(),
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────

async function disconnect(userId, categoryId) {
  await supabase
    .from('youtube_connections')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId)
}

// ── Pull comment sentiment ────────────────────────────────────────────────────
// Fetches recent top-level comments from the channel's latest videos,
// then Gemini extracts what the audience loves, hates, and is asking for.

async function pullCommentSentiment(accessToken, maxVideos = 10) {
  const axios = require('axios')
  const headers = { Authorization: `Bearer ${accessToken}` }

  try {
    // Get channel ID
    const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'id,snippet', mine: true }, headers,
    })
    const channelId = channelRes.data.items?.[0]?.id
    if (!channelId) return null

    // Get latest videos
    const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'id', channelId, order: 'date', type: 'video', maxResults: maxVideos },
      headers,
    })
    const videoIds = (videosRes.data.items || []).map(v => v.id?.videoId).filter(Boolean)
    if (!videoIds.length) return null

    // Pull top comments from each video
    const allComments = []
    for (const videoId of videoIds.slice(0, 5)) {
      try {
        const commentsRes = await axios.get('https://www.googleapis.com/youtube/v3/commentThreads', {
          params: { part: 'snippet', videoId, order: 'relevance', maxResults: 20 },
          headers,
        })
        const comments = (commentsRes.data.items || []).map(item =>
          item.snippet?.topLevelComment?.snippet?.textDisplay || ''
        ).filter(Boolean)
        allComments.push(...comments)
      } catch { continue }
    }

    if (allComments.length < 3) return null

    // Gemini sentiment analysis
    const { GoogleGenerativeAI } = require('@google/generative-ai')
    if (!process.env.GEMINI_API_KEY) return { raw: allComments.slice(0, 50) }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const prompt = `Analyse these YouTube comments from a music content creator's channel and extract audience sentiment.

Comments (${allComments.length} total):
${allComments.slice(0, 60).join('\n')}

Return ONLY valid JSON, no markdown:
{
  "loves": ["what they consistently praise or react positively to"],
  "wants": ["specific content requests or recurring questions"],
  "pain": ["frustrations, complaints, or things confusing them"],
  "emotionalTriggers": ["what type of content generates the strongest reactions"],
  "topPhrases": ["recurring words or phrases that reveal how they think about this content"],
  "sentimentScore": 0-100,
  "commentCount": ${allComments.length},
  "analysedAt": "${new Date().toISOString()}"
}`

    const result = await model.generateContent(prompt)
    const text   = result.response.text().replace(/\`\`\`json|\`\`\`/g, '').trim()
    return JSON.parse(text)
  } catch (err) {
    console.warn('[youtube/commentSentiment] Failed:', err.message)
    return null
  }
}

module.exports = {
  buildAuthUrl,
  exchangeCode,
  storeTokens,
  getValidToken,
  getChannelInfo,
  pullAnalyticsData,
  pullAudienceDemographics,
  pullCommentSentiment,
  getConnectionStatus,
  disconnect,
}