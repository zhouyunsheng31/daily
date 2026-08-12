import { Component, type ErrorInfo, type ReactNode } from 'react'

interface GlobalErrorBoundaryProps {
  children: ReactNode
  resetKeys?: unknown[]
}

interface GlobalErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class GlobalErrorBoundary extends Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[GlobalErrorBoundary] Caught error:', error, errorInfo)
  }

  componentDidUpdate(prevProps: GlobalErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKeys !== this.props.resetKeys) {
      const prevKeys = prevProps.resetKeys ?? []
      const nextKeys = this.props.resetKeys ?? []
      if (prevKeys.length !== nextKeys.length || prevKeys.some((k, i) => k !== nextKeys[i])) {
        this.setState({ hasError: false, error: null })
      }
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  handleReset = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    const error = this.state.error

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1e1e2e',
          color: '#ffffff',
          padding: '24px',
          borderRadius: '8px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ maxWidth: '640px', width: '100%' }}>
          <div
            style={{
              background: 'rgba(220, 38, 38, 0.15)',
              border: '1px solid rgba(220, 38, 38, 0.5)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
              页面渲染出错
            </div>
            <div style={{ fontSize: '13px', opacity: 0.85, marginBottom: '8px' }}>
              {error?.name ?? 'Error'}: {error?.message ?? '未知错误'}
            </div>
            {error?.stack && (
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '200px',
                  overflow: 'auto',
                }}
              >
                {error.stack}
              </pre>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                padding: '8px 16px',
                background: '#4a4a6a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              重试
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: '8px 16px',
                background: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              重置应用
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default GlobalErrorBoundary
