// frontend/src/pages/SeriesPage.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Film, TrendingUp, Clock, Copy } from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi } from '../lib/api'

export default function SeriesPage() {
  const { activeCategoryId, activeCategory } = useStore()
  const [episodes, setEpisodes] = useState([])
  const [duping, setDuping]     = useState(null)

  const navigate = useNavigate()

  async function duplicateEp(ep) {
    setDuping(ep.id)
    try {
      const { episode: clone } = await episodesApi.duplicate(ep.id)
      setEpisodes(prev => [clone, ...prev])
      // Navigate to Generate pre-filled with the cloned episode context
      const params = new URLSearchParams({
        trackName:    ep.track_name   || '',
        mood:         ep.track_mood   || '',
        genre:        ep.track_genre  || '',
        bpm:          ep.track_bpm    || '',
        episodeNumber: clone.episode_number,
        from:         'duplicate',
      })
      navigate('/generate?' + params.toString())
    } catch (err) {
      console.error('Duplicate failed:', err.message)
    }
    setDuping(null)
  }
  const [loading, setLoading]   = useState(true)
  const cat = activeCategory?.()

  useEffect(() => {
    if (!activeCategoryId) return
    episodesApi.list({ categoryId: activeCategoryId, limit: 50 })
      .then(({ episodes }) => { setEpisodes(episodes || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activeCategoryId])

  const STATUS_COLORS = {
    draft: '#444', generating: '#c8b89a', ready: '#40a060',
    recorded: '#4080c8', published: '#c8b89a'
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Series</h1>
        {cat && <p className="text-sm text-[#555] mt-1">{cat.name} · {episodes.length} episodes</p>}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_,i) => (
          <div key={i} className="h-16 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
        ))}</div>
      ) : episodes.length ? (
        <div className="space-y-2">
          {episodes.map(ep => (
            <div key={ep.id} className="flex items-center gap-4 px-5 py-4 bg-[#0a0a0a] border border-[#111] rounded hover:border-[#222] transition-colors">
              <span className="text-sm font-mono text-[#444] w-8">#{ep.episode_number}</span>
              <div className="flex-1">
                <div className="text-sm text-[#ccc]">{ep.track_name}</div>
                <div className="text-xs text-[#444] mt-0.5">{ep.track_mood} {ep.track_genre ? `· ${ep.track_genre}` : ''}</div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                {ep.yt_retention_score && (
                  <span className="flex items-center gap-1 text-[#c8b89a]">
                    <TrendingUp size={10}/> {ep.yt_retention_score}%
                  </span>
                )}
                {ep.published_at && (
                  <span className="flex items-center gap-1 text-[#444]">
                    <Clock size={10}/>
                    {new Date(ep.published_at).toLocaleDateString()}
                  </span>
                )}
                <button
                  onClick={() => duplicateEp(ep)}
                  disabled={duping === ep.id}
                  className="p-1.5 text-[#444] hover:text-[#c8b89a] transition-colors disabled:opacity-40"
                  title="Duplicate this episode as a starting point"
                >
                  <Copy size={12}/>
                </button>
                <span className="px-2 py-0.5 rounded border text-[10px]"
                  style={{ borderColor: STATUS_COLORS[ep.status]+'40', color: STATUS_COLORS[ep.status] }}>
                  {ep.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-[#444]">
          <Film size={32} className="mx-auto mb-3 opacity-30"/>
          <div className="text-sm">No episodes yet</div>
          <div className="text-xs mt-1">Generate your first episode to start the series</div>
        </div>
      )}
    </div>
  )
}
