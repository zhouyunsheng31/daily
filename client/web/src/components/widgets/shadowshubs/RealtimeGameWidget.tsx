// ============================================================================
// Phase 7 §14.4：shadowshubs 联机游戏 widget
//
// 对应 shadowshubs 原能力：联机游戏（realtime WebSocket）
// 显示简单的实时聊天/状态 UI（模拟数据演示，不需要真实 WebSocket）
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { Wifi, Send, Users, Circle } from 'lucide-react'

interface ChatMessage {
  id: number
  user: string
  avatar: string
  content: string
  timestamp: string
  isSelf?: boolean
}

interface OnlinePlayer {
  id: string
  name: string
  avatar: string
  status: 'idle' | 'playing' | 'waiting'
  game?: string
}

const MOCK_PLAYERS: OnlinePlayer[] = [
  { id: 'p1', name: 'Alice', avatar: '🐱', status: 'playing', game: '俄罗斯方块' },
  { id: 'p2', name: 'Bob', avatar: '🐶', status: 'waiting' },
  { id: 'p3', name: 'Carol', avatar: '🦊', status: 'playing', game: '贪吃蛇' },
  { id: 'p4', name: 'Dave', avatar: '🐰', status: 'idle' },
]

const MOCK_REPLIES: string[] = [
  '有人想玩 2048 吗？',
  '我刚赢了俄罗斯方块！50 行！',
  '等一下，我去倒杯水',
  '这个平台的游戏真不错',
  'Bob 来玩贪吃蛇吧',
  '今天状态不错，连胜 3 局',
]

const INITIAL_MESSAGES: ChatMessage[] = [
  { id: 1, user: 'Alice', avatar: '🐱', content: '大家好！有人想玩联机游戏吗？', timestamp: '14:01' },
  { id: 2, user: 'Bob', avatar: '🐶', content: '我可以！玩什么？', timestamp: '14:02' },
  { id: 3, user: 'Carol', avatar: '🦊', content: '我在玩贪吃蛇，你们继续', timestamp: '14:03' },
]

const STATUS_COLORS: Record<OnlinePlayer['status'], string> = {
  idle: '#999',
  playing: '#2ECC71',
  waiting: '#F39C12',
}

const STATUS_LABELS: Record<OnlinePlayer['status'], string> = {
  idle: '空闲',
  playing: '游戏中',
  waiting: '等待中',
}

export interface RealtimeGameWidgetProps {
  onEnter?: () => void
}

export default function RealtimeGameWidget({ onEnter: _onEnter }: RealtimeGameWidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const msgIdRef = useRef(4)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 模拟连接
  useEffect(() => {
    const timer = setTimeout(() => setConnected(true), 800)
    return () => clearTimeout(timer)
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 模拟其他玩家偶尔发消息
  useEffect(() => {
    if (!connected) return
    const interval = setInterval(() => {
      const player = MOCK_PLAYERS[Math.floor(Math.random() * MOCK_PLAYERS.length)]
      const reply = MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)]
      const now = new Date()
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      setMessages(prev => [...prev, {
        id: msgIdRef.current++,
        user: player.name,
        avatar: player.avatar,
        content: reply,
        timestamp: time,
      }])
    }, 8000 + Math.random() * 5000)
    return () => clearInterval(interval)
  }, [connected])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    setMessages(prev => [...prev, {
      id: msgIdRef.current++,
      user: '我',
      avatar: '😎',
      content: text,
      timestamp: time,
      isSelf: true,
    }])
    setInput('')

    // 模拟回复
    if (replyTimerRef.current) clearTimeout(replyTimerRef.current)
    replyTimerRef.current = setTimeout(() => {
      const player = MOCK_PLAYERS[Math.floor(Math.random() * MOCK_PLAYERS.length)]
      const replies = ['好的！', '哈哈哈', '收到', '我也这么觉得', '来玩一局？']
      const reply = replies[Math.floor(Math.random() * replies.length)]
      const replyNow = new Date()
      const replyTime = `${String(replyNow.getHours()).padStart(2, '0')}:${String(replyNow.getMinutes()).padStart(2, '0')}`
      setMessages(prev => [...prev, {
        id: msgIdRef.current++,
        user: player.name,
        avatar: player.avatar,
        content: reply,
        timestamp: replyTime,
      }])
    }, 1500 + Math.random() * 1000)
  }, [input])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div
      className="shadowshubs-widget-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 20,
        borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(231,76,60,0.08), rgba(155,89,182,0.08))',
        border: '1px solid var(--border-default)',
        minHeight: 180,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #E74C3C, #9B59B6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <Wifi size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            联机游戏
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 500 }}>
              <Circle size={8} fill={connected ? '#2ECC71' : '#999'} color={connected ? '#2ECC71' : '#999'} />
              {connected ? '已连接' : '连接中...'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Realtime Game · {MOCK_PLAYERS.length} 人在线</div>
        </div>
      </div>

      {/* 在线玩家 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--border-default)',
      }}>
        <Users size={12} color="var(--text-tertiary)" />
        {MOCK_PLAYERS.map(p => (
          <div key={p.id} title={`${p.name} — ${STATUS_LABELS[p.status]}${p.game ? ` (${p.game})` : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 14 }}>{p.avatar}</span>
            <Circle size={6} fill={STATUS_COLORS[p.status]} color={STATUS_COLORS[p.status]} />
          </div>
        ))}
      </div>

      {/* 聊天区域 */}
      <div style={{
        height: 180,
        overflowY: 'auto',
        padding: 8,
        borderRadius: 8,
        background: 'rgba(0,0,0,0.15)',
        border: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
            flexDirection: msg.isSelf ? 'row-reverse' : 'row',
          }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{msg.avatar}</span>
            <div style={{
              maxWidth: '75%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.isSelf ? 'flex-end' : 'flex-start',
            }}>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 1 }}>
                {msg.user} · {msg.timestamp}
              </div>
              <div style={{
                padding: '5px 9px',
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.4,
                background: msg.isSelf ? 'linear-gradient(135deg, #4A90E2, #50E3C2)' : 'rgba(255,255,255,0.08)',
                color: msg.isSelf ? '#fff' : 'var(--text-primary)',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected}
          placeholder={connected ? '输入消息，回车发送...' : '正在连接服务器...'}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-default)',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--text-primary)',
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!connected || !input.trim()}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: connected && input.trim() ? 'linear-gradient(135deg, #E74C3C, #9B59B6)' : 'rgba(231,76,60,0.3)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: connected && input.trim() ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: 'inherit',
          }}
        >
          <Send size={11} />
          发送
        </button>
      </div>
    </div>
  )
}
