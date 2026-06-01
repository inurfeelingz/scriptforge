// backend/src/routes/kb.js
// KB document indexing — PDF, DOC, DOCX
// Mounts at /api/kb
// POST /api/kb/index-doc — extract text from document, save to vault so KB can reference it

const express = require('express')
const multer  = require('multer')
const os      = require('os')
const path    = require('path')
const fs      = require('fs')
const { supabase } = require('../utils/supabase')

const router = express.Router()

const docUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename:    (req, file, cb) => cb(null, `kb-doc-${Date.now()}-${file.originalname.replace(/[^a-z0-9._-]/gi, '_')}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },  // 50MB max
})

// ─── POST /api/kb/index-doc ───────────────────────────────────────────────────
// Accepts PDF, DOC, DOCX. Extracts text and saves as a vault entry so KB
// can reference the document content in conversations.

router.post('/index-doc', docUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' })

  const { categoryId, title } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  const tmpPath = req.file.path
  const ext     = path.extname(req.file.originalname).toLowerCase()
  const docTitle = title || path.basename(req.file.originalname, ext)

  try {
    let extractedText = ''
    let wordCount     = 0

    if (ext === '.pdf') {
      // Extract text from PDF using pdftotext (poppler-utils, available on Railway)
      const { execSync } = require('child_process')
      try {
        extractedText = execSync(`pdftotext "${tmpPath}" -`, { maxBuffer: 10 * 1024 * 1024 }).toString('utf8').trim()
      } catch {
        // Fallback: try pdf-parse npm package
        try {
          const pdfParse = require('pdf-parse')
          const buf      = fs.readFileSync(tmpPath)
          const data     = await pdfParse(buf)
          extractedText  = data.text?.trim() || ''
        } catch (e2) {
          throw new Error('Could not extract text from PDF — it may be a scanned image. Try a text-based PDF.')
        }
      }

    } else if (ext === '.docx') {
      const mammoth = require('mammoth')
      const result  = await mammoth.extractRawText({ path: tmpPath })
      extractedText = result.value?.trim() || ''

    } else if (ext === '.doc') {
      // Legacy .doc — use antiword if available, otherwise error
      const { execSync } = require('child_process')
      try {
        extractedText = execSync(`antiword "${tmpPath}"`, { maxBuffer: 10 * 1024 * 1024 }).toString('utf8').trim()
      } catch {
        throw new Error('.doc format not supported — please convert to .docx or .pdf first.')
      }

    } else {
      throw new Error(`Unsupported document type: ${ext}. Use PDF or DOCX.`)
    }

    if (!extractedText) {
      throw new Error('No text could be extracted from this document. It may be image-only.')
    }

    wordCount = extractedText.trim().split(/\s+/).length

    // Save to vault so KB reads it in context
    const { data, error } = await supabase.from('vault_entries').insert({
      user_id:     req.user.id,
      category_id: categoryId,
      type:        'document',
      title:       docTitle,
      content:     extractedText.slice(0, 15000),  // cap at 15k chars for context safety
      tags:        ['uploaded', 'document', ext.replace('.', '')],
    }).select().single()

    if (error) throw new Error(error.message)

    console.log(`[kb/index-doc] Indexed "${docTitle}" — ${wordCount} words for user ${req.user.id}`)

    res.json({
      success:   true,
      id:        data.id,
      title:     docTitle,
      wordCount,
      truncated: extractedText.length > 15000,
    })

  } catch (err) {
    console.error('[kb/index-doc]', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
})

module.exports = router
