import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  widgetType: string
  widgetId: string
  children: ReactNode
  onRetry?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[WidgetErrorBoundary] ${this.props.widgetType}(${this.props.widgetId}) crashed:`, error, info.componentStack)
  }

  private handleRetry = () => {
    // 只 remount，不修改 state
    this.props.onRetry?.()
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 16,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          color: 'var(--text-secondary)',
        }}>
          <div style={{ fontSize: 24, opacity: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AlertTriangle size={24} style={{ opacity: 0.5 }} /></div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            组件渲染出错
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 240 }}>
            {this.props.widgetType}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--color-error)',
            background: 'rgba(255,59,48,0.08)',
            padding: '6px 10px',
            borderRadius: 6,
            maxWidth: 280,
            wordBreak: 'break-word',
            maxHeight: 60,
            overflow: 'auto',
          }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: 4,
              padding: '5px 14px',
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
