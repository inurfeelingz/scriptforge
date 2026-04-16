// frontend/src/components/editor/IndexingPanel.jsx
// Footage folder picker + indexing progress display
// STATUS: PLACEHOLDER — UI complete, worker calls stubbed

import { useState } from 'react'
import { FolderOpen, Cpu, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react'

export default function IndexingPanel({ indexer, onClose }) {
  const [files, setFiles] = useState([])

  async function pickAndIndex() {
    const picked = await indexer.pickFolder()
    if (!picked.length) return
    setFiles(picked)
    await indexer.indexBatch(picked)
  }

  return (
    <div className="border border-[#1a1a1a] rounded overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-[#0a0a0a] border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-[#c8b89a]"/>
          <span className="text-sm text-[#888]">Footage indexer</span>
        </div>
        <button onClick={onClose} className="text-[#444] hover:text-[#888] transition-colors"><X size={14}/></button>
      </div>

      <div className="p-5 space-y-5">

        {/* Model status */}
        <div className="flex items-center gap-3 text-xs">
          {indexer.modelsLoading ? (
            <>
              <Loader2 size={12} className="animate-spin text-[#c8b89a]"/>
              <span className="text-[#666]">Loading {indexer.modelProgress.model}... {indexer.modelProgress.pct}%</span>
            </>
          ) : indexer.modelsReady ? (
            <>
              <CheckCircle size={12} className="text-[#40a060]"/>
              <span className="text-[#555]">Models ready (CLIP + Whisper + MiniLM)</span>
            </>
          ) : (
            <>
              <div className="w-3 h-3 rounded-full border border-[#444]"/>
              <span className="text-[#444]">Models not loaded — initialise before indexing</span>
            </>
          )}
        </div>

        {/* How it works */}
        <div className="text-xs text-[#444] border border-[#111] rounded p-4 leading-relaxed space-y-1">
          <div className="text-[#666] mb-2">What happens during indexing:</div>
          <div>1. CLIP extracts visual meaning from each clip (runs on your GPU/CPU locally)</div>
          <div>2. Whisper transcribes any spoken audio in each clip</div>
          <div>3. Vectors are saved to your Supabase account for fast search</div>
          <div className="text-[#555] mt-2">First run: ~2–5 min per clip. Subsequent runs: instant (cached).</div>
          <div className="text-[#555]">Note: Requires Chrome/Edge — WebCodecs not supported in Firefox/Safari.</div>
        </div>

        {/* Folder picker */}
        {!indexer.indexing ? (
          <div className="space-y-3">
            {!indexer.modelsReady && (
              <button
                onClick={indexer.initModels}
                disabled={indexer.modelsLoading}
                className="w-full py-2.5 border border-[#1a1a1a] rounded text-sm text-[#666] hover:text-[#aaa] hover:border-[#333] transition-all disabled:opacity-40"
              >
                {indexer.modelsLoading ? 'Loading models...' : 'Load AI models first'}
              </button>
            )}
            <button
              onClick={pickAndIndex}
              disabled={!indexer.modelsReady || indexer.indexing}
              className="w-full py-3 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium hover:bg-[#e8c87a] disabled:opacity-40 transition-all flex items-center justify-center gap-2"
            >
              <FolderOpen size={14}/>
              Select footage folder and index
            </button>
            {files.length > 0 && (
              <div className="text-xs text-[#444]">{files.length} video files selected</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#666]">{indexer.indexProgress.filename || 'Processing...'}</span>
              <span className="text-[#c8b89a]">{indexer.indexProgress.current}/{indexer.indexProgress.total}</span>
            </div>
            <div className="h-1.5 bg-[#111] rounded overflow-hidden">
              <div
                className="h-full bg-[#c8b89a] transition-all duration-300"
                style={{ width: `${indexer.indexProgress.pct}%` }}
              />
            </div>
            <div className="text-xs text-[#444] capitalize">{indexer.indexProgress.step}...</div>
            <button onClick={indexer.cancel} className="text-xs text-red-400 hover:underline">Cancel</button>
          </div>
        )}

        {/* Current stats */}
        {indexer.stats?.total > 0 && (
          <div className="text-xs text-[#555] border-t border-[#111] pt-3 space-y-1">
            <div>Indexed: {indexer.stats.total} clips</div>
            {Object.entries(indexer.stats.byType || {}).map(([type, count]) => (
              <div key={type} className="pl-3 text-[#444]">{type}: {count}</div>
            ))}
            <div className="text-[#444]">Total footage: {Math.round((indexer.stats.totalDurationMs || 0) / 60000)} min</div>
          </div>
        )}
      </div>
    </div>
  )
}
