'use client'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'

const AGENTS: Record<string, { icon: string; name: string; color: string }> = {
  'orchestrator':       { icon: '🧠', name: 'Orchestrator',  color: 'var(--amber)' },
  'macro-agent':        { icon: '🌍', name: 'Macro',         color: 'var(--cyan)' },
  'correlation-agent':  { icon: '🔗', name: 'Correlation',   color: 'var(--blue)' },
  'bull-agent':         { icon: '🐂', name: 'Bull',          color: 'var(--green)' },
  'bear-agent':         { icon: '🐻', name: 'Bear',          color: 'var(--red)' },
  'scalper-agent':      { icon: '⚡', name: 'Scalper',       color: 'var(--amber)' },
  'trend-agent':        { icon: '📈', name: 'Trend',         color: 'var(--blue)' },
  'market-analyst':     { icon: '📰', name: 'Analyst',       color: 'var(--purple)' },
  'signal-generator':   { icon: '🎯', name: 'Signal',        color: 'var(--green)' },
  'risk-manager':       { icon: '🛡', name: 'Risk',          color: 'var(--red)' },
  'trade-reviewer':     { icon: '📊', name: 'Reviewer',      color: 'var(--amber)' },
  'master-agent':       { icon: '👑', name: 'Master',        color: 'var(--purple)' },
}

const LEFT_SIDE  = ['macro-agent', 'correlation-agent', 'bull-agent', 'bear-agent', 'scalper-agent']
const RIGHT_SIDE = ['trend-agent', 'market-analyst', 'signal-generator', 'risk-manager', 'trade-reviewer']

interface Msg { id: string; meeting_id: string; agent: string; role: string; message: string; instrument: string; created_at: string; data?: Record<string, unknown> }
interface Meeting { id: string; instrument: string; messageCount: number; startedAt: string; decision: string; messages: Msg[] }

function getStance(message: string): 'bull' | 'bear' | 'neutral' {
  const l = message.toLowerCase()
  const bu = ['long', 'bullish', 'buy', 'upside', 'bounce', 'rally', 'recovery', 'approve', 'execute'].filter(w => l.includes(w)).length
  const be = ['short', 'bearish', 'sell', 'downside', 'breakdown', 'drop', 'correction', 'reject', 'against'].filter(w => l.includes(w)).length
  return bu > be ? 'bull' : be > bu ? 'bear' : 'neutral'
}

function fmtTime(d: string) { return d ? new Date(d).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '—' }
function fmtTimeSec(d: string) { return d ? new Date(d).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—' }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short' }) : '' }

function meetingStatus(m: Meeting): 'executed' | 'rejected' | 'pending' {
  const dec = m.messages?.find(msg => msg.role === 'decision')
  if (dec?.data?.execute === true) return 'executed'
  if (dec?.data?.execute === false) return 'rejected'
  const d = m.decision?.toLowerCase() ?? ''
  if (d.includes('executed') || d.includes('approved')) return 'executed'
  if (d.includes('rejected')) return 'rejected'
  return 'pending'
}

export default function WarRoomPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [msgCache, setMsgCache] = useState<Record<string, Msg[]>>({})
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/war-room?limit=20').then(r => r.json()).then(d => {
      setMeetings(d.meetings ?? [])
      if (d.meetings?.length) setSelectedMeeting(d.meetings[0].id)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedMeeting || msgCache[selectedMeeting]) return
    setLoadingMsgs(true)
    fetch(`/api/war-room?meeting=${selectedMeeting}`).then(r => r.json()).then(d => {
      setMsgCache(prev => ({ ...prev, [selectedMeeting]: d.data ?? [] }))
      setLoadingMsgs(false)
    }).catch(() => setLoadingMsgs(false))
  }, [selectedMeeting, msgCache])

  const meeting = meetings.find(m => m.id === selectedMeeting)
  const allMsgs = msgCache[selectedMeeting ?? ''] ?? []
  const speaks = useMemo(() => allMsgs.filter(m => m.role === 'speak' || m.role === 'decision' || m.role === 'alert'), [allMsgs])
  const visibleMsgs = useMemo(() => speaks.slice(0, step + 1), [speaks, step])
  const activeMsg = speaks[step]
  const activeAgentId = activeMsg?.agent
  const decisionMsg = useMemo(() => allMsgs.find(m => m.role === 'decision'), [allMsgs])

  const stances = useMemo(() => {
    const s: Record<string, 'bull' | 'bear' | 'neutral'> = {}
    for (const m of visibleMsgs) {
      if (m.role === 'speak') s[m.agent] = getStance(m.message)
    }
    return s
  }, [visibleMsgs])

  const liveVotes = useMemo(() => {
    let f = 0, a = 0
    for (const m of visibleMsgs) {
      if (m.role !== 'speak') continue
      const st = getStance(m.message)
      if (st === 'bull') f++; else if (st === 'bear') a++
    }
    return { f, a }
  }, [visibleMsgs])

  useEffect(() => { setStep(0); setPlaying(false) }, [selectedMeeting])
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, [step])

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setStep(s => { if (s >= speaks.length - 1) { setPlaying(false); return s } return s + 1 })
    }, 4000)
    return () => clearInterval(t)
  }, [playing, speaks.length])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'ArrowRight') setStep(s => Math.min(s + 1, Math.max(speaks.length - 1, 0)))
    else if (e.key === 'ArrowLeft') setStep(s => Math.max(s - 1, 0))
    else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
  }, [speaks.length])
  useEffect(() => { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onKey])

  const total = liveVotes.f + liveVotes.a
  const pct = total > 0 ? (liveVotes.f / total) * 100 : 50

  return (
    <div className="h-full flex" style={{ background: 'var(--bg-0)' }}>
      {/* ── Sidebar ── */}
      <div className="w-48 flex-shrink-0 overflow-y-auto" style={{ background: 'var(--bg-1)', borderRight: '1px solid var(--border)' }}>
        <div className="p-2">
          <div className="text-[8px] font-bold tracking-[.2em] mb-2 px-1" style={{ color: 'var(--amber)' }}>WAR ROOM</div>
          {loading && <div className="text-[10px] p-2" style={{ color: 'var(--text-3)' }}>Loading...</div>}
          {!loading && meetings.length === 0 && (
            <div className="text-[10px] p-2" style={{ color: 'var(--text-3)' }}>No sessions yet.</div>
          )}
          {meetings.map(m => {
            const st = meetingStatus(m)
            const on = selectedMeeting === m.id
            return (
              <button key={m.id} onClick={() => setSelectedMeeting(m.id)} className="w-full text-left px-2 py-2 rounded mb-0.5" style={{
                background: on ? 'var(--bg-2)' : 'transparent',
                borderLeft: on ? '2px solid var(--amber)' : '2px solid transparent',
              }}>
                <div className="flex items-center gap-1.5">
                  <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: st === 'executed' ? 'var(--green)' : st === 'rejected' ? 'var(--red)' : 'var(--text-3)',
                  }} />
                  <span className="text-[11px] font-bold" style={{ color: on ? 'var(--text-0)' : 'var(--text-1)' }}>{m.instrument}</span>
                  <span className="text-[8px] ml-auto" style={{ color: 'var(--text-3)' }}>{msgCache[m.id]?.length ?? m.messageCount}</span>
                </div>
                <div className="text-[8px] mt-0.5 pl-4" style={{ color: 'var(--text-2)' }}>
                  {fmtDate(m.startedAt)} {fmtTime(m.startedAt)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Main: Boardroom + Chat ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-1.5 flex-shrink-0" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--amber)' }}>WAR ROOM</span>
            {meeting && <>
              <span className="text-[12px] font-bold" style={{ color: 'var(--text-0)' }}>{meeting.instrument}</span>
              <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{fmtDate(meeting.startedAt)} {fmtTime(meeting.startedAt)}</span>
            </>}
          </div>
          {meeting && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold" style={{ color: 'var(--green)' }}>{liveVotes.f} FOR</span>
              <div style={{ width: 50, height: 4, borderRadius: 2, background: 'var(--bg-3)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 2, transition: 'width .5s' }} />
              </div>
              <span className="text-[9px] font-bold" style={{ color: 'var(--red)' }}>{liveVotes.a} AGAINST</span>
            </div>
          )}
        </div>

        {/* Body: Boardroom left + Chat right */}
        <div className="flex-1 flex overflow-hidden">
          {/* ── 3D Boardroom ── */}
          <div className="flex-1 flex items-center justify-center overflow-hidden p-4" style={{ perspective: '900px', minWidth: 0 }}>
            <div className="flex items-stretch gap-4 w-full max-w-[800px]" style={{ transform: 'rotateX(8deg)', transformStyle: 'preserve-3d' }}>
              {/* Left agents column */}
              <div className="flex flex-col gap-2 justify-center flex-shrink-0">
                {LEFT_SIDE.map(id => (
                  <AgentCard key={id} id={id} active={id === activeAgentId} stance={stances[id]}
                    onClick={() => { const i = speaks.findIndex(m => m.agent === id); if (i >= 0) { setStep(i); setPlaying(false) } }} />
                ))}
              </div>

              {/* Conference Table */}
              <div className="flex-1 rounded-2xl flex flex-col items-center justify-center p-6 min-h-[300px] relative" style={{
                background: 'linear-gradient(170deg, #3d2b1a 0%, #2a1d10 35%, #1f150c 70%, #1a1008 100%)',
                border: '2px solid rgba(139, 90, 43, 0.3)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,220,160,0.06), inset 0 -2px 0 rgba(0,0,0,0.3)',
              }}>
                {/* Wood grain subtle overlay */}
                <div className="absolute inset-0 rounded-2xl opacity-[0.03]" style={{
                  backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(255,255,255,0.1) 40px, rgba(255,255,255,0.1) 41px)',
                }} />

                {/* Table content */}
                <div className="relative z-10 text-center">
                  {meeting ? (
                    <>
                      <div className="text-[8px] tracking-[.25em] font-bold mb-1" style={{ color: 'rgba(255,220,160,0.4)' }}>
                        {activeMsg ? 'SPEAKING' : 'SESSION'}
                      </div>
                      {activeMsg && (
                        <div className="text-2xl mb-1">{AGENTS[activeMsg.agent]?.icon}</div>
                      )}
                      <div className="text-xl font-bold mb-1" style={{ color: '#e8dcc8' }}>{meeting.instrument}</div>

                      {/* Live vote display */}
                      <div className="flex items-center justify-center gap-4 mt-3">
                        <div className="text-center">
                          <div className="text-xl font-bold" style={{ color: 'var(--green)' }}>{liveVotes.f}</div>
                          <div className="text-[7px] font-bold tracking-widest" style={{ color: 'rgba(34,197,94,0.6)' }}>FOR</div>
                        </div>
                        <div style={{ width: 60, height: 5, borderRadius: 3, background: 'rgba(239,68,68,0.2)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 3, transition: 'width .6s' }} />
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-bold" style={{ color: 'var(--red)' }}>{liveVotes.a}</div>
                          <div className="text-[7px] font-bold tracking-widest" style={{ color: 'rgba(239,68,68,0.6)' }}>AGAINST</div>
                        </div>
                      </div>

                      {/* Decision badge */}
                      {step >= speaks.length - 1 && decisionMsg?.data && (
                        <div className="mt-4 text-[10px] font-bold px-4 py-1.5 rounded-full inline-block" style={{
                          background: decisionMsg.data.execute ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          color: decisionMsg.data.execute ? 'var(--green)' : 'var(--red)',
                          border: `1px solid ${decisionMsg.data.execute ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                        }}>
                          {decisionMsg.data.execute ? '✓ TRADE APPROVED' : '✕ TRADE REJECTED'}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-3xl mb-2 opacity-30">⚔</div>
                      <div className="text-[11px]" style={{ color: 'rgba(255,220,160,0.3)' }}>Select a session</div>
                    </>
                  )}
                </div>

                {/* Orchestrator at head of table */}
                <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
                  <AgentCard id="orchestrator" active={activeAgentId === 'orchestrator'} stance={stances['orchestrator']} isChair
                    onClick={() => { const i = speaks.findIndex(m => m.agent === 'orchestrator'); if (i >= 0) { setStep(i); setPlaying(false) } }} />
                </div>

                {/* Master agent at other end */}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2">
                  <AgentCard id="master-agent" active={activeAgentId === 'master-agent'} stance={stances['master-agent']}
                    onClick={() => { const i = speaks.findIndex(m => m.agent === 'master-agent'); if (i >= 0) { setStep(i); setPlaying(false) } }} />
                </div>
              </div>

              {/* Right agents column */}
              <div className="flex flex-col gap-2 justify-center flex-shrink-0">
                {RIGHT_SIDE.map(id => (
                  <AgentCard key={id} id={id} active={id === activeAgentId} stance={stances[id]}
                    onClick={() => { const i = speaks.findIndex(m => m.agent === id); if (i >= 0) { setStep(i); setPlaying(false) } }} />
                ))}
              </div>
            </div>
          </div>

          {/* ── Chat Panel ── */}
          <div className="w-[400px] flex-shrink-0 flex flex-col" style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-1)' }}>
            {/* Chat header */}
            <div className="px-3 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-[9px] font-bold tracking-wide" style={{ color: 'var(--text-2)' }}>
                DISCUSSION {speaks.length > 0 ? `${step + 1}/${speaks.length}` : ''}
              </span>
              <button onClick={() => setPlaying(p => !p)} className="text-[8px] font-bold px-3 py-1 rounded-full" style={{
                background: playing ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                color: playing ? 'var(--red)' : 'var(--green)',
                border: `1px solid ${playing ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
              }}>
                {playing ? '⏸ PAUSE' : '▶ PLAY'}
              </button>
            </div>

            {/* Messages */}
            <div ref={chatRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {loadingMsgs ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-[11px] animate-pulse" style={{ color: 'var(--text-3)' }}>Loading discussion...</div>
                </div>
              ) : visibleMsgs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-center">
                  <div>
                    <div className="text-2xl mb-2 opacity-20">💬</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {!selectedMeeting ? 'Select a session' : speaks.length === 0 ? 'No discussion in this session' : 'Press ▶ PLAY to start'}
                    </div>
                  </div>
                </div>
              ) : (
                visibleMsgs.map((msg, i) => {
                  const agent = AGENTS[msg.agent] ?? { icon: '⚡', name: msg.agent, color: 'var(--text-2)' }
                  const stance = msg.role === 'speak' ? getStance(msg.message) : null
                  const isDecision = msg.role === 'decision'
                  const isLatest = i === visibleMsgs.length - 1

                  return (
                    <div key={msg.id ?? i} className="rounded-lg px-3 py-2 animate-slide-in" style={{
                      background: isDecision ? 'rgba(245,158,11,0.06)' : isLatest ? 'var(--bg-2)' : 'transparent',
                      border: isDecision ? '1px solid rgba(245,158,11,0.15)' : '1px solid transparent',
                    }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{agent.icon}</span>
                        <span className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.name}</span>
                        {isDecision && (
                          <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)' }}>
                            DECISION
                          </span>
                        )}
                        {stance && stance !== 'neutral' && !isDecision && (
                          <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{
                            background: stance === 'bull' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                            color: stance === 'bull' ? 'var(--green)' : 'var(--red)',
                          }}>
                            {stance === 'bull' ? '▲ BULL' : '▼ BEAR'}
                          </span>
                        )}
                        <span className="text-[7px] ml-auto" style={{ color: 'var(--text-3)' }}>{fmtTimeSec(msg.created_at)}</span>
                      </div>
                      <div className="text-[11px] leading-[1.65]" style={{ color: isDecision ? 'var(--text-0)' : 'var(--text-1)' }}>
                        {msg.message}
                      </div>
                      {isDecision && msg.data && (
                        <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                          <span className="text-[10px] font-bold" style={{ color: 'var(--green)' }}>{String(msg.data.votesFor ?? liveVotes.f)} FOR</span>
                          <span className="text-[10px] font-bold" style={{ color: 'var(--red)' }}>{String(msg.data.votesAgainst ?? liveVotes.a)} AGAINST</span>
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{
                            background: msg.data.execute ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                            color: msg.data.execute ? 'var(--green)' : 'var(--red)',
                          }}>
                            {msg.data.execute ? '✓ APPROVED' : '✕ REJECTED'}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* Playback controls */}
            <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-0)' }}>
              <button onClick={() => setStep(0)} className="text-[9px] px-1.5 py-1 rounded" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>⏮</button>
              <button onClick={() => setStep(s => Math.max(0, s - 1))} className="text-[9px] px-1.5 py-1 rounded" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>◀</button>

              <div className="flex-1 h-1.5 rounded-full cursor-pointer" style={{ background: 'var(--bg-3)' }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setStep(Math.round(((e.clientX - r.left) / r.width) * Math.max(speaks.length - 1, 0)))
                }}>
                <div style={{
                  width: speaks.length > 0 ? `${((step + 1) / speaks.length) * 100}%` : '0%',
                  height: '100%', borderRadius: 4, transition: 'width .3s',
                  background: activeAgentId ? (AGENTS[activeAgentId]?.color ?? 'var(--amber)') : 'var(--amber)',
                }} />
              </div>

              <button onClick={() => setStep(s => Math.min(speaks.length - 1, s + 1))} className="text-[9px] px-1.5 py-1 rounded" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>▶</button>
              <button onClick={() => setStep(speaks.length - 1)} className="text-[9px] px-1.5 py-1 rounded" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>⏭</button>

              <span className="text-[7px] font-mono" style={{ color: 'var(--text-3)' }}>
                {speaks.length > 0 ? `${step + 1}/${speaks.length}` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentCard({ id, active, stance, isChair, onClick }: {
  id: string; active: boolean; stance?: 'bull' | 'bear' | 'neutral'; isChair?: boolean; onClick: () => void
}) {
  const a = AGENTS[id]
  if (!a) return null
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 rounded-lg transition-all relative" style={{
      padding: '6px 8px',
      minWidth: 64,
      background: active ? 'var(--bg-2)' : 'var(--bg-1)',
      border: active ? `1.5px solid ${a.color}` : '1.5px solid var(--border)',
      boxShadow: active ? `0 0 12px color-mix(in srgb, ${a.color} 30%, transparent)` : '0 2px 4px rgba(0,0,0,0.1)',
    }}>
      <span style={{ fontSize: isChair ? 26 : 20 }}>{a.icon}</span>
      <span className="text-[8px] font-bold" style={{ color: active ? a.color : 'var(--text-2)' }}>{a.name}</span>
      {isChair && <span className="text-[5px] tracking-[.12em] font-bold" style={{ color: 'var(--amber)', opacity: 0.6 }}>CHAIR</span>}
      {stance && stance !== 'neutral' && (
        <span className="text-[7px] font-bold" style={{ color: stance === 'bull' ? 'var(--green)' : 'var(--red)' }}>
          {stance === 'bull' ? '▲' : '▼'}
        </span>
      )}
    </button>
  )
}
