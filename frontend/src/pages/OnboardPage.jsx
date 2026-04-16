// frontend/src/pages/OnboardPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { categories as catApi } from '../lib/api'
import { useStore } from '../store'

const STEPS = ['Your show', 'Your niche', 'Done']

export default function OnboardPage() {
  const [step, setStep]   = useState(0)
  const [form, setForm]   = useState({ name: '', niche: '', description: '' })
  const [saving, setSaving] = useState(false)
  const { loadCategories, setActiveCategory, notify } = useStore()
  const navigate = useNavigate()

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function finish() {
    setSaving(true)
    try {
      const { category } = await catApi.create({
        name:        form.name || 'My show',
        niche:       form.niche || 'content creation',
        description: form.description,
        color:       '#c8b89a',
      })
      await loadCategories()
      await setActiveCategory(category.id)
      navigate('/')
    } catch (err) {
      notify(err.message, 'error')
    }
    setSaving(false)
  }

  const CONTENT = [
    {
      title:       'What is your show called?',
      description: 'This becomes your first category — you can add more later for client work.',
      fields: [
        { key: 'name', label: 'Show name', placeholder: 'Making Echoes — a music documentary' },
      ],
    },
    {
      title:       'What niche or topic does it cover?',
      description: 'This shapes how Claude searches for trends and competitor content.',
      fields: [
        { key: 'niche',       label: 'Niche',       placeholder: 'music production, lo-fi soul' },
        { key: 'description', label: 'Description', placeholder: 'A documentary series about making music...' },
      ],
    },
  ]

  const current = CONTENT[step]

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">

        {/* Progress */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all ${
                i <= step ? 'bg-[#c8b89a] text-[#080808]' : 'border border-[#333] text-[#444]'
              }`}>{i + 1}</div>
              {i < STEPS.length - 1 && <div className={`h-px w-8 transition-all ${i < step ? 'bg-[#c8b89a]' : 'bg-[#222]'}`}/>}
            </div>
          ))}
        </div>

        {step < CONTENT.length ? (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-serif text-[#f0ede8]">{current.title}</h1>
              <p className="text-sm text-[#555] mt-2">{current.description}</p>
            </div>
            {current.fields.map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-[#666]">{label}</label>
                <input value={form[key]} onChange={e => setField(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40"/>
              </div>
            ))}
            <button onClick={() => setStep(s => s + 1)}
              className="w-full py-3 bg-[#c8b89a] text-[#080808] font-medium rounded hover:bg-[#e8c87a] transition-all">
              Continue
            </button>
          </div>
        ) : (
          <div className="space-y-6 text-center">
            <div>
              <h1 className="text-2xl font-serif text-[#f0ede8]">You're ready</h1>
              <p className="text-sm text-[#555] mt-2">ScriptForge will ingest competitor content and set up your workspace. This takes a minute.</p>
            </div>
            <div className="border border-[#1a1a1a] rounded p-4 text-left space-y-2">
              <div className="text-xs text-[#888]">Summary</div>
              <div className="text-sm text-[#ccc]">{form.name || 'My show'}</div>
              <div className="text-xs text-[#555]">{form.niche || 'content creation'}</div>
            </div>
            <button onClick={finish} disabled={saving}
              className="w-full py-3 bg-[#c8b89a] text-[#080808] font-medium rounded hover:bg-[#e8c87a] disabled:opacity-40 transition-all">
              {saving ? 'Setting up your workspace...' : 'Enter ScriptForge'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
