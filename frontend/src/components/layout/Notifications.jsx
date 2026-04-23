// frontend/src/components/layout/Notifications.jsx
import { useStore } from '../../store'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

export default function Notifications() {
  const notifications = useStore(s => s.notifications)

  const ICONS = { success: CheckCircle, error: AlertCircle, info: Info }
  const COLORS = {
    success: 'border-[#40a060]/30 bg-[#40a060]/5 text-[#40a060]',
    error:   'border-red-800/30 bg-red-950/20 text-red-400',
    info:    'border-[#c8b89a]/20 bg-[#c8b89a]/5 text-[#c8b89a]',
  }

  if (!notifications.length) return null

  return (
    <div className="fixed bottom-6 right-6 space-y-2 z-50">
      {notifications.map(n => {
        const Icon = ICONS[n.type] || Info
        return (
          <div key={n.id} className={`flex items-center gap-3 px-4 py-3 rounded border text-sm max-w-sm ${COLORS[n.type] || COLORS.info} animate-in slide-in-from-right`}>
            <Icon size={14} className="shrink-0"/>
            <span className="flex-1">{n.message}</span>
          </div>
        )
      })}
    </div>
  )
}
