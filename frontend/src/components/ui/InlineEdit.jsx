// frontend/src/components/ui/InlineEdit.jsx
// Click-to-edit inline component. Used wherever content should be editable.
// Usage: <InlineEdit value={text} onSave={async (val) => { await api.patch(...) }} />

import { useState, useRef, useEffect } from 'react'
import { Check, X, Pencil } from 'lucide-react'

export default function InlineEdit({
  value       = '',
  onSave,
  placeholder = 'Click to edit',
  multiline   = false,
  className   = '',
  style       = {},
  disabled    = false,
  label       = null,
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const inputRef = useRef(null)

  // Sync external value changes
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  // Focus on enter edit
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      if (!multiline) inputRef.current?.select()
    }
  }, [editing, multiline])

  async function save() {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
    setError(null)
  }

  function handleKeyDown(e) {
    if (!multiline && e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') cancel()
  }

  if (disabled) {
    return <span className={className} style={style}>{value || placeholder}</span>
  }

  if (!editing) {
    return (
      <div
        className={`group inline-flex items-start gap-1.5 cursor-pointer ${className}`}
        style={{ ...style, minWidth: 40 }}
        onClick={() => setEditing(true)}
        title="Click to edit"
      >
        {label && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'center' }}>{label}</span>}
        <span style={{
          color: value ? 'inherit' : 'rgba(255,255,255,0.2)',
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          overflow: multiline ? 'visible' : 'hidden',
          textOverflow: multiline ? 'clip' : 'ellipsis',
        }}>
          {value || placeholder}
        </span>
        <Pencil
          size={11}
          style={{ color: 'rgba(74,222,128,0.4)', flexShrink: 0, marginTop: 2, opacity: 0, transition: 'opacity 0.15s' }}
          className="group-hover:opacity-100"
        />
      </div>
    )
  }

  const sharedStyle = {
    background:  'rgba(255,255,255,0.04)',
    border:      '1px solid rgba(74,222,128,0.3)',
    borderRadius: 6,
    color:       '#f0ede8',
    fontFamily:  'inherit',
    fontSize:    'inherit',
    fontWeight:  'inherit',
    lineHeight:  'inherit',
    outline:     'none',
    padding:     multiline ? '6px 10px' : '2px 8px',
    width:       '100%',
    resize:      multiline ? 'vertical' : 'none',
    minHeight:   multiline ? 80 : 'auto',
    boxSizing:   'border-box',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      {label && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>}
      {multiline ? (
        <textarea
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          style={sharedStyle}
          rows={4}
        />
      ) : (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          style={sharedStyle}
        />
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 5, border: 'none', background: 'rgba(74,222,128,0.15)', color: 'rgba(74,222,128,1)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree', sans-serif" }}
        >
          <Check size={10}/> {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={cancel}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree', sans-serif" }}
        >
          <X size={10}/> Cancel
        </button>
        {error && <span style={{ fontSize: 11, color: '#e05050' }}>{error}</span>}
        {!multiline && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Enter to save · Esc to cancel</span>}
      </div>
    </div>
  )
}