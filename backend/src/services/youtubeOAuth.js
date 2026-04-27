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
      metrics:    'views,averageViewPercentage,estimatedMinutesWatched,averageViewDuration,impressionClickThroughRate',
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
      ctr:               parseFloat(get('impressionClickThroughRate') || '0'),
      avgViewDuration:   get('averageViewDuration') || '',
    }
  }).filter(v => v.title && v.title !== v.videoId)
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

module.exports = {
  buildAuthUrl,
  exchangeCode,
  storeTokens,
  getValidToken,
  getChannelInfo,
  pullAnalyticsData,
  getConnectionStatus,
  disconnect,
}
