import { useState, useRef, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Music, Music2, Play, Pause, X, Volume2, SkipForward, SkipBack, ListMusic, Repeat, Repeat1, Shuffle } from 'lucide-react'
import { savePlaylist, getPlaylist } from '../../utils/db'
import type { MusicTrack, MusicPlaylist } from '../../types'

interface Props {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  onEditingChange?: (editing: boolean) => void
}

const DEFAULT_PLAYLIST: Omit<MusicPlaylist, 'widgetId'> = {
  tracks: [],
  currentTrackIndex: -1,
  currentTime: 0,
  volume: 0.8,
  isPlaying: false,
  playMode: 'sequence',
}

export default function MusicPlayer({ widgetId, onUpdateState }: Props) {
  const [playlist, setPlaylist] = useState<MusicPlaylist>({ ...DEFAULT_PLAYLIST, widgetId })
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [seekOnLoad, setSeekOnLoad] = useState<number | null>(null)

  const loadPlaylist = useCallback(() => {
    getPlaylist(widgetId).then(saved => {
      if (saved) {
        setPlaylist(saved)
        setCurrentTime(saved.currentTime)
        setIsPlaying(false)
        setSeekOnLoad(saved.currentTime)
        if (onUpdateState) onUpdateState({ songCount: saved.tracks.length })
      }
      setLoaded(true)
    })
  }, [widgetId, onUpdateState])

  useEffect(() => {
    loadPlaylist()
  }, [loadPlaylist])

  // Listen for AI tool execution events to refresh data when AI updates playlists
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.store === 'music' || detail?.targetType === 'music') {
        loadPlaylist()
      }
    }
    window.addEventListener('ai-entity-changed', handler)
    return () => window.removeEventListener('ai-entity-changed', handler)
  }, [loadPlaylist])

  const debouncedSave = useCallback((data: MusicPlaylist) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      savePlaylist(data)
    }, 500)
  }, [])

  const updatePlaylist = useCallback((updater: (prev: MusicPlaylist) => MusicPlaylist) => {
    setPlaylist(prev => {
      const next = updater(prev)
      debouncedSave(next)
      return next
    })
  }, [debouncedSave])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onLoadedMetadata = () => {
      setDuration(audio.duration)
      if (seekOnLoad !== null && seekOnLoad > 0 && seekOnLoad < audio.duration) {
        audio.currentTime = seekOnLoad
        setCurrentTime(seekOnLoad)
        setSeekOnLoad(null)
      }
    }
    const onTimeUpdate = () => {
      const t = audio.currentTime
      setCurrentTime(t)
      updatePlaylist(prev => ({ ...prev, currentTime: t }))
    }
    const onEnded = () => {
      setIsPlaying(false)
      updatePlaylist(prev => {
        const nextIndex = getNextIndex(prev)
        if (nextIndex === -1) return { ...prev, isPlaying: false, currentTrackIndex: -1 }
        return { ...prev, currentTrackIndex: nextIndex, currentTime: 0, isPlaying: true }
      })
    }
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
    }
  }, [updatePlaylist, seekOnLoad])

  useEffect(() => {
    if (!loaded) return
    const track = playlist.tracks[playlist.currentTrackIndex]
    if (!track) return
    const audio = audioRef.current
    if (!audio) return
    audio.volume = playlist.volume
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, playlist.currentTrackIndex])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = playlist.volume
  }, [playlist.volume])

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      updatePlaylist(prev => ({ ...prev, isPlaying: false }))
    } else {
      audio.play().then(() => {
        setIsPlaying(true)
        updatePlaylist(prev => ({ ...prev, isPlaying: true }))
        if (onUpdateState) onUpdateState({ lastPlayedAt: Date.now() })
      }).catch(() => {})
    }
  }, [isPlaying, updatePlaylist, onUpdateState])

  const handleAddFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newTracks: MusicTrack[] = []
    let loaded = 0

    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        const tempAudio = new Audio(dataUrl)
        tempAudio.addEventListener('loadedmetadata', () => {
          newTracks.push({
            id: uuidv4(),
            name: file.name.replace(/\.[^.]+$/, ''),
            dataUrl,
            duration: tempAudio.duration,
            addedAt: Date.now(),
          })
          loaded++
          if (loaded === files.length) {
            updatePlaylist(prev => {
              const tracks = [...prev.tracks, ...newTracks]
              const currentTrackIndex = prev.currentTrackIndex === -1 ? 0 : prev.currentTrackIndex
              if (onUpdateState) onUpdateState({ songCount: tracks.length })
              return { ...prev, tracks, currentTrackIndex }
            })
          }
        })
        tempAudio.addEventListener('error', () => {
          loaded++
          if (loaded === files.length && newTracks.length > 0) {
            updatePlaylist(prev => {
              const tracks = [...prev.tracks, ...newTracks]
              const currentTrackIndex = prev.currentTrackIndex === -1 ? 0 : prev.currentTrackIndex
              if (onUpdateState) onUpdateState({ songCount: tracks.length })
              return { ...prev, tracks, currentTrackIndex }
            })
          }
        })
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }, [updatePlaylist])

  const handleRemoveTrack = useCallback((trackId: string) => {
    updatePlaylist(prev => {
      const idx = prev.tracks.findIndex(t => t.id === trackId)
      if (idx === -1) return prev
      const tracks = prev.tracks.filter(t => t.id !== trackId)
      let currentTrackIndex = prev.currentTrackIndex
      if (idx < currentTrackIndex) currentTrackIndex--
      else if (idx === currentTrackIndex) {
        currentTrackIndex = tracks.length === 0 ? -1 : Math.min(idx, tracks.length - 1)
      }
      if (onUpdateState) onUpdateState({ songCount: tracks.length })
      return { ...prev, tracks, currentTrackIndex }
    })
  }, [updatePlaylist, onUpdateState])

  const handleSelectTrack = useCallback((index: number) => {
    updatePlaylist(prev => ({ ...prev, currentTrackIndex: index, currentTime: 0 }))
    setIsPlaying(true)
    if (onUpdateState) onUpdateState({ lastPlayedAt: Date.now() })
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = 0
      audio.play().catch(() => {})
    }
  }, [updatePlaylist])

  const handlePrev = useCallback(() => {
    updatePlaylist(prev => {
      if (prev.tracks.length === 0) return prev
      const idx = prev.currentTrackIndex <= 0 ? prev.tracks.length - 1 : prev.currentTrackIndex - 1
      return { ...prev, currentTrackIndex: idx, currentTime: 0 }
    })
    setIsPlaying(true)
  }, [updatePlaylist])

  const handleNext = useCallback(() => {
    updatePlaylist(prev => {
      if (prev.tracks.length === 0) return prev
      const idx = (prev.currentTrackIndex + 1) % prev.tracks.length
      return { ...prev, currentTrackIndex: idx, currentTime: 0 }
    })
    setIsPlaying(true)
  }, [updatePlaylist])

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = e.currentTarget
    const rect = bar.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const audio = audioRef.current
    if (audio && duration) {
      audio.currentTime = percent * duration
      setCurrentTime(percent * duration)
    }
  }, [duration])

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value)
    updatePlaylist(prev => ({ ...prev, volume: vol }))
  }, [updatePlaylist])

  const cyclePlayMode = useCallback(() => {
    updatePlaylist(prev => {
      const modes: MusicPlaylist['playMode'][] = ['sequence', 'loop', 'shuffle']
      const idx = modes.indexOf(prev.playMode)
      return { ...prev, playMode: modes[(idx + 1) % modes.length] }
    })
  }, [updatePlaylist])

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const currentTrack = playlist.tracks[playlist.currentTrackIndex]
  // Phase 4 任务 9: 图标统一审计，替换 emoji 为 lucide-react 图标
  const PlayModeIcon = playlist.playMode === 'sequence' ? Repeat : playlist.playMode === 'loop' ? Repeat1 : Shuffle

  return (
    <div className="music-player-body">
      <audio
        ref={audioRef}
        src={currentTrack?.dataUrl || undefined}
        preload="metadata"
      />

      <div className="music-album-art">{currentTrack ? <Music size={32} /> : <Music2 size={32} />}</div>

      {currentTrack ? (
        <>
          <span className="music-track-name">{currentTrack.name}</span>
          <span className="music-artist-name">{playlist.tracks.length} 首歌曲</span>

          <div className="music-progress-bar" data-widget-interactive="true" onClick={handleProgressClick}>
            <div className="music-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="music-time-display">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="music-controls">
            <button className="music-control-btn" onClick={cyclePlayMode} title={playlist.playMode}>
              <PlayModeIcon size={14} />
            </button>
            <button className="music-control-btn" onClick={handlePrev}><SkipBack size={14} /></button>
            <button className="music-control-btn play-btn" onClick={handlePlayPause}>
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button className="music-control-btn" onClick={handleNext}><SkipForward size={14} /></button>
            <button className="music-control-btn" onClick={() => setShowPlaylist(!showPlaylist)} title="歌单">
              <ListMusic size={14} />
            </button>
          </div>

          <div className="music-volume-row">
            <span style={{ fontSize: 12 }}><Volume2 size={12} /></span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={playlist.volume}
              onChange={handleVolumeChange}
              style={{ width: 80, accentColor: 'var(--color-primary)' }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="workspace-empty-text">添加音乐文件开始播放</p>
          <button className="toolbar-btn primary" onClick={() => fileInputRef.current?.click()}>
            选择文件
          </button>
        </>
      )}

      {showPlaylist && (
        <div className="music-playlist-panel">
          <div className="music-playlist-header">
            <span>歌单 ({playlist.tracks.length})</span>
            <button className="music-playlist-add-btn" onClick={() => fileInputRef.current?.click()}>+ 添加</button>
          </div>
          <div className="music-playlist-list">
            {playlist.tracks.map((track, i) => (
              <div
                key={track.id}
                className={`music-playlist-item ${i === playlist.currentTrackIndex ? 'active' : ''}`}
                onClick={() => handleSelectTrack(i)}
                data-widget-interactive="true"
              >
                <span className="music-playlist-item-name">{track.name}</span>
                <span className="music-playlist-item-duration">{formatTime(track.duration)}</span>
                <button
                  className="music-playlist-item-remove"
                  onClick={(e) => { e.stopPropagation(); handleRemoveTrack(track.id) }}
                ><X size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleAddFiles}
      />
    </div>
  )
}

function getNextIndex(playlist: MusicPlaylist): number {
  const { tracks, currentTrackIndex, playMode } = playlist
  if (tracks.length === 0) return -1
  if (playMode === 'loop') return currentTrackIndex
  if (playMode === 'shuffle') return Math.floor(Math.random() * tracks.length)
  const next = currentTrackIndex + 1
  return next >= tracks.length ? -1 : next
}
