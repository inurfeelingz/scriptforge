# ScriptForge Vision Engine — Implementation Status

All files are built. This doc tracks what's working vs what needs fleshing out,
in priority order. Debug everything first, then flesh out top to bottom.

---

## Database (run first)

| File | Status | Notes |
|------|--------|-------|
| `supabase/schema_vision.sql` | **READY** | Run after main schema.sql. Adds clip_index, editor_projects, indexing_jobs tables + pgvector + match_clips function |

---

## Backend — Priority order

| File | Status | Flesh out |
|------|--------|-----------|
| `backend/src/routes/editor/index.js` | **WIRED** | Routes all connected. Handler logic calls services below. |
| `backend/src/services/vision/clipIndexer.js` | **STUB** | `indexClip`, `indexClipBatch`, `searchClips` — implement vector upsert + pgvector query |
| `backend/src/services/vision/visionMatcher.js` | **STUB** | `matchBeat`, `matchFullEDL`, `getSwapCandidates` — wire to clipIndexer search |
| `backend/src/services/vision/timelineBuilder.js` | **PARTIAL** | `buildTimeline`, `exportEDL` working. `exportFCPXML`, `exportOTIO` are stubs. |

---

## Frontend — Priority order

| File | Status | Flesh out |
|------|--------|-----------|
| `frontend/src/workers/clipIndexer.worker.js` | **STUB** | Load Transformers.js models, WebCodecs frame extraction, CLIP vectors, Whisper transcripts |
| `frontend/src/hooks/useClipIndexer.js` | **WIRED** | Instantiate the real worker (line 27). File System Access API (line 64). |
| `frontend/src/pages/EditorPage.jsx` | **WIRED** | Tabs work. Assembly trigger stubbed. |
| `frontend/src/components/editor/IndexingPanel.jsx` | **WIRED** | UI complete. Worker calls go through `useClipIndexer`. |
| `frontend/src/components/editor/ClipLibrary.jsx` | **PARTIAL** | Text search works. Semantic vector search needs worker live. |
| `frontend/src/components/editor/HybridTimeline.jsx` | **WIRED** | Timeline display works. Assembly needs EDL + vectors. |
| `frontend/src/components/editor/EditorExport.jsx` | **WORKING** | EDL export fully functional. FCPXML/OTIO are stubs. |

---

## Flesh-out order (one-man team, debug as you go)

### Pass 1 — Get data flowing (2–3 days)
1. Run `schema_vision.sql` in Supabase
2. Test all `/api/editor/*` routes with Postman/Insomnia — confirm auth, confirm DB writes
3. Implement `clipIndexer.indexClip` — hardcode a test clip with dummy vectors, confirm pgvector stores it
4. Implement `clipIndexer.searchClips` — confirm `match_clips` function returns results
5. Test `/api/editor/clips/search` end-to-end with hardcoded vectors

### Pass 2 — Wire the worker (2–3 days)
6. Uncomment the real worker in `useClipIndexer.js` (line 27)
7. Install `@xenova/transformers` in frontend package.json
8. Implement `loadModels()` in the worker — confirm CLIP + Whisper + MiniLM load
9. Implement `extractThumbnail()` — get a real frame from a video file
10. Implement `computeVisualVector()` and `computeTextVector()` — confirm 512/384 dim output
11. Test full index flow: pick folder → worker runs → vectors arrive at API → saved to DB

### Pass 3 — Assembly (1–2 days)
12. Implement `visionMatcher.matchFullEDL()` — wire EDL parsing + clip search
13. Implement `timelineBuilder.buildTimeline()` — generate correct timecodes
14. Test assemble button: episode EDL → matched timeline → review in UI

### Pass 4 — Polish (1 day)
15. Implement `exportFCPXML()` in timelineBuilder
16. Test EDL import into DaVinci — verify files link correctly
17. Implement semantic swap UI — show 3 candidates on click

---

## Dependencies to install

```bash
# Frontend
npm install @xenova/transformers --workspace=frontend

# These are already in frontend package.json:
# react-router-dom, zustand, lucide-react, @supabase/supabase-js
```

## Browser compatibility note

The vision engine requires Chrome/Edge (Chromium).
- WebCodecs API: Chrome 94+, Edge 94+. Not in Firefox or Safari.
- File System Access API: Chrome 86+, Edge 86+. Not in Firefox.
- Transformers.js: All modern browsers (no WebCodecs dependency).

Show a browser gate in IndexingPanel if `!('VideoDecoder' in window)`.
