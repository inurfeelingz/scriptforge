// frontend/src/pages/OnboardPage.jsx
// Step 1 of setup: collect show name + niche via simple form.
// After workspace created → redirect to KB home which runs the voice profile interview.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { categories as catApi } from '../lib/api'
import { useStore } from '../store'

const GREEN     = 'rgba(74,222,128,1)'
const GREEN_LOW = 'rgba(74,222,128,0.08)'
const GREEN_MID = 'rgba(74,222,128,0.2)'

export default function OnboardPage() {
  const [step,   setStep]   = useState(0)
  const [form,   setForm]   = useState({ name: '', niche: '', description: '' })
  const [saving, setSaving] = useState(false)
  const { loadCategories, setActiveCategory, notify } = useStore()
  const navigate = useNavigate()

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function finish() {
    if (!form.name.trim())  { notify('Give your show a name', 'error'); return }
    if (!form.niche.trim()) { notify('Add a niche so KB knows what to search', 'error'); return }
    setSaving(true)
    try {
      const { category } = await catApi.create({
        name:        form.name.trim(),
        niche:       form.niche.trim(),
        description: form.description.trim(),
        color:       '#4ade80',
      })
      await loadCategories()
      await setActiveCategory(category.id)
      // Go to KB home with onboarding flag — KB will run the voice profile interview
      navigate('/?onboarding=1')
    } catch (err) {
      notify(err.message, 'error')
    }
    setSaving(false)
  }

  const STEPS = [
    {
      title:   "What's your show called?",
      sub:     "This becomes your first workspace. You can add more later.",
      fields:  [{ key: 'name', label: 'Show name', placeholder: 'FeelzMachine — Music Creation', type: 'text' }],
    },
    {
      title:   "What niche does it cover?",
      sub:     "KB uses this to find trends, competitor content and relevant hooks for your episodes.",
      fields:  [
        { key: 'niche',       label: 'Niche / topic',  placeholder: 'music production, AI music tools, lo-fi beat making', type: 'text' },
        { key: 'description', label: 'One-liner (optional)', placeholder: 'A documentary series about making music with AI...', type: 'text' },
      ],
    },
  ]

  const current = STEPS[step]

  return (
    <div style={{
      minHeight: '100vh', background: '#080c10',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: '#e8eaed', letterSpacing: '-0.5px', marginBottom: 6 }}>
            WhispaCuts
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree', sans-serif" }}>
            Let's set up your workspace
          </div>
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 36 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width:        i === step ? 24 : 8,
              height:       8,
              borderRadius: 4,
              background:   i <= step ? GREEN : 'rgba(255,255,255,0.08)',
              transition:   'all 0.3s ease',
            }}/>
          ))}
          <div style={{ width: 8, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)' }}/>
        </div>

        {/* Form card */}
        <div style={{
          background:   'rgba(255,255,255,0.03)',
          border:       '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          padding:      32,
        }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, color: '#f0ede8', marginBottom: 8, letterSpacing: '-0.3px' }}>
              {current.title}
            </h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
              {current.sub}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
            {current.fields.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>
                  {label}
                </label>
                <input
                  value={form[key]}
                  onChange={e => setField(key, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && step < STEPS.length - 1) setStep(s => s + 1) }}
                  placeholder={placeholder}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid rgba(255,255,255,0.1)`,
                    borderRadius: 8, padding: '10px 14px',
                    fontSize: 14, color: '#f0ede8',
                    fontFamily: "'Figtree', sans-serif",
                    outline: 'none',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.target.style.borderColor = GREEN_MID}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>
            ))}
          </div>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!form[current.fields[0].key].trim()}
              style={{
                width: '100%', padding: '12px 0',
                background: form[current.fields[0].key].trim() ? GREEN : 'rgba(74,222,128,0.15)',
                border: 'none', borderRadius: 10,
                fontSize: 14, fontWeight: 600,
                color: form[current.fields[0].key].trim() ? '#080808' : 'rgba(74,222,128,0.4)',
                cursor: form[current.fields[0].key].trim() ? 'pointer' : 'default',
                fontFamily: "'Figtree', sans-serif",
                transition: 'all 0.15s',
              }}
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={saving || !form.niche.trim()}
              style={{
                width: '100%', padding: '12px 0',
                background: !saving && form.niche.trim() ? GREEN : 'rgba(74,222,128,0.15)',
                border: 'none', borderRadius: 10,
                fontSize: 14, fontWeight: 600,
                color: !saving && form.niche.trim() ? '#080808' : 'rgba(74,222,128,0.4)',
                cursor: !saving && form.niche.trim() ? 'pointer' : 'default',
                fontFamily: "'Figtree', sans-serif",
                transition: 'all 0.15s',
              }}
            >
              {saving ? 'Setting up…' : 'Enter WhispaCuts →'}
            </button>
          )}

          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{ width: '100%', marginTop: 10, padding: '8px 0', background: 'none', border: 'none', fontSize: 13, color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontFamily: "'Figtree', sans-serif" }}
            >
              ← Back
            </button>
          )}
        </div>

        {/* Step 3 preview — what happens next */}
        {step === 1 && (
          <div style={{ marginTop: 20, padding: '14px 18px', background: GREEN_LOW, border: `1px solid ${GREEN_MID}`, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: GREEN, fontWeight: 600, marginBottom: 4, fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              What happens next
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6 }}>
              KB will ask you a few quick questions about how you talk on camera and what you make. This builds your voice profile so every script sounds like <em>you</em>.
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
