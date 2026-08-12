import { useAppStore } from '../stores/useAppStore'
import { Check, Circle, AlertCircle } from 'lucide-react'

export default function SaveIndicator() {
  const saveStatus = useAppStore(s => s.saveStatus)

  const statusConfig = {
    saved: { label: '已保存', className: 'saved' },
    saving: { label: '保存中...', className: 'saving' },
    error: { label: '保存失败', className: 'error' },
  }

  const config = statusConfig[saveStatus.status]

  return (
    <div className={`save-indicator ${config.className}`}>
      {config.label === '已保存' ? <Check size={10} /> : config.label === '保存中...' ? <Circle size={10} /> : <AlertCircle size={10} />}
      <span>{config.label}</span>
    </div>
  )
}
