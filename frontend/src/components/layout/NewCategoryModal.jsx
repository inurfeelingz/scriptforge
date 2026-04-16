// frontend/src/components/layout/NewCategoryModal.jsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { categories as catApi } from '../../lib/api'
import { useStore } from '../../store'

const COLORS = ['#6366f1','#c8b89a','#40a060','#e8c87a','#4080c8','#d04060','#808040']

export default function NewCategoryModal({ onClose, onCreated }) {
  const { notify } = useStore()
  const [form, setForm]     = useState({ name: '', niche: '', color: COLORS[0] })
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!form.name.trim() || !form.niche.trim()) return notify('Name and niche required', 'error')
    setSaving(true)
    try {
      await catApi.create(form)
      await onCreated()
      notify(`Category "${form.name}" created`, 'success')
    } catch (err) { notify(err.message, 'error') }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#0d0d0d] border border-[#1e1e1e] rounded w-full max-w-md space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-serif text-[#f0ede8]">New category</h2>
          <button onClick={onClose} className="text-[#444] hover:text-[#888] transition-colors"><X size={16}/></button>
        </div>

        {[
          { key: 'name',  label: 'Name',  placeholder: 'Music documentary' },
          { key: 'niche', label: 'Niche', placeholder: 'music production' },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="text-xs text-[#666]">{label}</label>
            <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="w-full bg-[#080808] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40"/>
          </div>
        ))}

        <div className="space-y-2">
          <label className="text-xs text-[#666]">Colour</label>
          <div className="flex gap-2">
            {COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: form.color === c ? '#fff' : 'transparent' }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 border border-[#1e1e1e] rounded text-sm text-[#555] hover:text-[#888] transition-colors">Cancel</button>
          <button onClick={create} disabled={saving}
            className="flex-1 py-2.5 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium hover:bg-[#e8c87a] disabled:opacity-40 transition-all">
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
