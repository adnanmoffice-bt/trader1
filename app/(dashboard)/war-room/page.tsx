'use client'
import { useEffect, useState, useMemo } from 'react'

/* ─── Agent Metadata ─── */

const AGENTS: Record<string, { icon: string; name: string; color: string; title: string }> = {
  'orchestrator':       { icon: '🧠', name: 'Orchestrator',  color: 'var(--amber)',  title: 'Chairman' },
  'macro-agent':        { icon: '🌍', name: 'Macro',         color: 'var(--cyan)',   title: 'Macro Analyst' },
  'correlation-agent':  { icon: '🔗', name: 'Correlation',   color: 'var(--blue)',   title: 'Cross-Asset' },
  'bull-agent':         { icon: '🐂', name: 'Bull',          color: 'var(--green)',  title: 'Bull Advocate' },
  'bear-agent':         { icon: '🐻', name: 'Bear',          color: 'var(--red)',    title: 'Bear Advocate' },
  'scalper-agent':      { icon: '⚡', name: 'Scalper',       color: 'var(--cyan)',   title: 'Scalp Trader' },
  'trend-agent':        { icon: '📈', name: 'Trend',         color: 'var(--blue)',   title: 'Trend Follower' },
  'market-analyst':     { icon: '📰', name: 'Analyst',       color: 'var(--purple)', title: 'Sentiment' },
  'signal-generator':   { icon: '🎯', name: 'Signal',        color: 'var(--green)',  title: 'Signal Gen' },
  'risk-manager':       { icon: '🛡', name: 'Risk',          color: 'var(--red)',    title: 'Risk Mgr' },
  'trade-reviewer':     { icon: '📊', name: 'Reviewer',      color: 'var(--amber)',  title: 'Trade Review' },
  'master-agent':       { icon: '👑', name: 'Master',        color: 'var(--amber)',  title: 'Final Call' },
}

/* ─── Seat Positions Around the Oval Table (% of container) ─── */

const SEATS = [
  { id: 'macro-agent',       top: 5,  left: 22 },
  { id: 'correlation-agent', top: 2,  left: 50 },
  { id: 'bull-agent',        top: 5,  left: 78 },
  { id: 'bear-agent',        top: 28, left: 93 },
  { id: 'market-analyst',    top: 52, left: 96 },
  { id: 'risk-manager',      top: 74, left: 93 },
  { id: 'master-agent',      top: 95, left: 78 },
  { id: 'orchestrator',      top: 98, left: 50 },
  { id: 'trade-reviewer',    top: 95, left: 22 },
  { id: 'signal-generator',  top: 74, left: 7 },
  { id: 'trend-agent',       top: 52, left: 4 },
  { id: 'scalper-agent',     top: 28, left: 7 },
]

const ROLE_BADGE: Record<string, { bg: string; label: string }> = {
  open:     { bg: 'var(--bg-2)', label: 'OPEN' },
  speak:    { bg: 'var(--bg-2)', label: 'SPEAK' },
  question: { bg: 'var(--blue)', label: 'ASK' },
  decision: { bg: 'var(--amber)', label: 'DECISION' },
  alert:    { bg: 'var(--red)', label: 'ALERT' },
  close:    { bg: 'var(--bg-3)', label: 'CLOSE' },
}

/* ─── Types ─── */

interface Msg { id: string; meeting_id: string; agent: string; role: string; message: string; instrument: string; created_at: string; data?: Record<string, unknown> }
interface Meeting { id: string; instrument: string; messageCount: number; startedAt: string; decision: string; messages: Msg[] }

/* ─── Helpers ─── */

function getStance(message: string): 'bull' | 'bear' | 'neutral' {
  const l = message.toLowerCase()
  const bu = ['long', 'bullish', 'buy', 'upside', 'bounce', 'rally', 'recovery', 'accumulation'].filter(w => l.includes(w)).length
  const be = ['short', 'bearish', 'sell', 'downside', 'breakdown', 'drop', 'correction', 'decline'].filter(w => l.includes(w)).length
  return bu > be ? 'bull' : be > bu ? 'bear' : 'neutral'
}

function fmtTime(d: string) {
  return d ? new Date(d).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '—'
}

function fmtTimeSec(d: string) {
  return d ? new Date(d).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
}

function meetingStatus(m: Meeting): 'executed' | 'rejected' | 'pending' {
  const dec = m.messages.find(msg => msg.role === 'decision')
  if (dec?.data?.execute === true) return 'executed'
  if (dec?.data?.execute === false) return 'rejected'
  const d = m.decision?.toLowerCase() ?? ''
  if (d.includes('executed') || d.includes('approved')) return 'executed'
  if (d.includes('rejected')) return 'rejected'
  return 'pending'
}

/* ─── Component ─── */

export default function WarRoomPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [allMsgs, setAllMsgs] = useState<Msg[]>([])
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeStep, setActiveStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [viewMode, setViewMode] = useState<'boardroom' | 'transcript'>('boardroom')
  const [expandedMsg, setExpandedMsg] = useState(false)

  useEffect(() => {
    fetch('/api/war-room?limit=10').then(r => r.json()).then(d => {
      setMeetings(d.meetings ?? [])
      setAllMsgs(d.data ?? [])
      if (d.meetings?.length) setSelectedMeeting(d.meetings[0].id)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const currentMeeting = meetings.find(m => m.id === selectedMeeting)
  const displayMsgs = currentMeeting?.messages ?? allMsgs.filter(m => m.meeting_id === selectedMeeting)

  const speakMsgs = useMemo(
    () => displayMsgs.filter(m => m.role !== 'open' && m.role !== 'close'),
    [displayMsgs]
  )

  const activeMsg = speakMsgs[activeStep]
  const activeAgentId = activeMsg?.agent

  const agentStances = useMemo(() => {
    const s: Record<string, 'bull' | 'bear' | 'neutral'> = {}
    for (const msg of speakMsgs) {
      if (msg.agent && msg.role === 'speak') s[msg.agent] = getStance(msg.message)
    }
    return s
  }, [speakMsgs])

  const decisionMsg = useMemo(
    () => displayMsgs.find(m => m.role === 'decision'),
    [displayMsgs]
  )

  useEffect(() => { setActiveStep(0); setIsPlaying(false); setExpandedMsg(false) }, [selectedMeeting])
  useEffect(() => { setExpandedMsg(false) }, [activeStep])

  useEffect(() => {
    if (!isPlaying) return
    const timer = setInterval(() => {
      setActiveStep(s => {
        if (s >= speakMsgs.length - 1) { setIsPlaying(false); return s }
        return s + 1
      })
    }, 5000)
    return () => clearInterval(timer)
  }, [isPlaying, speakMsgs.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight') setActiveStep(s => Math.min(s + 1, Math.max(speakMsgs.length - 1, 0)))
      else if (e.key === 'ArrowLeft') setActiveStep(s => Math.max(s - 1, 0))
      else if (e.key === ' ') { e.preventDefault(); setIsPlaying(p => !p) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [speakMsgs.length])

  const votesFor = Number(decisionMsg?.data?.votesFor ?? 0)
  const votesAgainst = Number(decisionMsg?.data?.votesAgainst ?? 0)
  const totalVotes = votesFor + votesAgainst
  const forPct = totalVotes > 0 ? (votesFor / totalVotes) * 100 : 50

  return (
    <>
      <style>{`
        @keyframes seatPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--pulse-clr, transparent); }
          50% { box-shadow: 0 0 20px 8px var(--pulse-clr, transparent); }
        }
        @keyframes tableGlow {
          0%, 100% { box-shadow: 0 0 40px rgba(255,204,0,0.02), inset 0 0 60px rgba(0,0,0,0.5); }
          50% { box-shadow: 0 0 80px rgba(255,204,0,0.06), inset 0 0 40px rgba(0,0,0,0.3); }
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .seat-pulse { animation: seatPulse 2s ease-in-out infinite; }
        .table-glow { animation: tableGlow 5s ease-in-out infinite; }
        .msg-fade { animation: fadeIn 0.4s ease-out; }
      `}</style>

      <div className="h-full flex">
        {/* ─── LEFT SIDEBAR: Meeting List ─── */}
        <div className="w-52 flex-shrink-0 overflow-y-auto" style={{ background: 'var(--bg-1)', borderRight: '1px solid var(--border)' }}>
          <div className="px-2 py-2">
            <div className="text-[9px] font-bold tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
              WAR ROOM SESSIONS
            </div>
            {loading && <div className="text-[10px] p-2" style={{ color: 'var(--text-3)' }}>Loading...</div>}
            {!loading && meetings.length === 0 && (
              <div className="text-[10px] p-2" style={{ color: 'var(--text-3)' }}>
                No meetings yet. Run the signals cron to start a War Room session.
              </div>
            )}
            {meetings.map(m => {
              const status = meetingStatus(m)
              const isActive = selectedMeeting === m.id
              return (
                <button key={m.id} onClick={() => setSelectedMeeting(m.id)} className="w-full text-left px-2 py-2 rounded mb-0.5 transition-all" style={{
                  background: isActive ? 'var(--bg-2)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--amber)' : '2px solid transparent',
                }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: status === 'executed' ? 'var(--green)' : status === 'rejected' ? 'var(--red)' : 'var(--text-3)',
                        boxShadow: status === 'executed' ? '0 0 6px var(--green)' : status === 'rejected' ? '0 0 6px var(--red)' : 'none',
                      }} />
                      <span className="text-[11px] font-bold" style={{ color: 'var(--text-0)' }}>{m.instrument}</span>
                    </div>
                    <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{m.messageCount} msgs</span>
                  </div>
                  <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-2)' }}>{fmtTime(m.startedAt)}</div>
                  <div className="text-[8px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{m.decision}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ─── MAIN AREA ─── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-0)' }}>
          {/* Header Bar */}
          <div className="flex items-center justify-between px-4 py-1.5 flex-shrink-0" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--amber)' }}>⚔ WAR ROOM</span>
              {currentMeeting && (
                <span className="text-[11px] font-bold" style={{ color: 'var(--text-0)' }}>{currentMeeting.instrument}</span>
              )}
              {currentMeeting && (
                <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{fmtTime(currentMeeting.startedAt)} Dubai</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(['boardroom', 'transcript'] as const).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)} className="text-[9px] font-bold px-2.5 py-1 rounded transition-all" style={{
                  background: viewMode === mode ? 'var(--bg-3)' : 'transparent',
                  color: viewMode === mode ? 'var(--amber)' : 'var(--text-3)',
                  border: viewMode === mode ? '1px solid var(--border)' : '1px solid transparent',
                }}>
                  {mode === 'boardroom' ? '🏛 BOARDROOM' : '📋 TRANSCRIPT'}
                </button>
              ))}
            </div>
          </div>

          {viewMode === 'boardroom' ? (
            /* ═══ BOARDROOM VIEW ═══ */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Table Area */}
              <div className="flex-1 relative overflow-hidden" style={{
                background: 'radial-gradient(ellipse at 50% 50%, rgba(255,204,0,0.012) 0%, transparent 55%)',
                minHeight: 300,
              }}>
                {/* The Oval Table */}
                <div className="absolute table-glow" style={{
                  top: '20%', left: '22%', width: '56%', height: '60%',
                  borderRadius: '50%',
                  background: 'radial-gradient(ellipse at 50% 42%, rgba(30,26,22,0.95) 0%, rgba(18,16,13,0.97) 45%, rgba(10,8,6,1) 100%)',
                  border: '1.5px solid rgba(255,204,0,0.1)',
                }}>
                  {/* Inner decorative ring */}
                  <div className="absolute" style={{
                    inset: '10%', borderRadius: '50%',
                    border: '1px solid rgba(255,204,0,0.04)',
                  }} />

                  {/* Center Content */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                    {currentMeeting ? (
                      <>
                        <div className="text-[7px] tracking-[0.25em] font-bold mb-1" style={{ color: 'var(--text-3)' }}>
                          SESSION ACTIVE
                        </div>
                        <div className="text-xl font-bold" style={{ color: 'var(--text-0)', letterSpacing: '0.05em' }}>
                          {currentMeeting.instrument}
                        </div>

                        {decisionMsg?.data ? (
                          <>
                            <div className="flex items-center gap-5 mt-3">
                              <div className="text-center">
                                <div className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{votesFor}</div>
                                <div className="text-[6px] font-bold tracking-[0.2em]" style={{ color: 'var(--green)', opacity: 0.7 }}>FOR</div>
                              </div>
                              <div style={{ width: 70, height: 5, borderRadius: 3, background: 'rgba(255,51,102,0.3)', overflow: 'hidden' }}>
                                <div style={{
                                  width: `${forPct}%`, height: '100%',
                                  background: 'var(--green)', borderRadius: 3,
                                  transition: 'width 0.6s ease',
                                }} />
                              </div>
                              <div className="text-center">
                                <div className="text-2xl font-bold" style={{ color: 'var(--red)' }}>{votesAgainst}</div>
                                <div className="text-[6px] font-bold tracking-[0.2em]" style={{ color: 'var(--red)', opacity: 0.7 }}>AGAINST</div>
                              </div>
                            </div>
                            <div className="mt-3 text-[9px] font-bold px-4 py-1.5 rounded-full" style={{
                              background: decisionMsg.data.execute ? 'rgba(0,255,163,0.1)' : 'rgba(255,51,102,0.1)',
                              color: decisionMsg.data.execute ? 'var(--green)' : 'var(--red)',
                              border: `1px solid ${decisionMsg.data.execute ? 'rgba(0,255,163,0.25)' : 'rgba(255,51,102,0.25)'}`,
                              letterSpacing: '0.12em',
                            }}>
                              {decisionMsg.data.execute ? '✓ TRADE APPROVED' : '✕ TRADE REJECTED'}
                            </div>
                          </>
                        ) : speakMsgs.length > 0 ? (
                          <div className="mt-2 text-[9px]" style={{ color: 'var(--text-3)' }}>
                            {speakMsgs.length} interventions &bull; Deliberating...
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="text-4xl mb-2 opacity-40">⚔</div>
                        <div className="text-[12px] font-bold mb-1" style={{ color: 'var(--text-2)' }}>War Room</div>
                        <div className="text-[9px]" style={{ color: 'var(--text-3)' }}>
                          {meetings.length === 0 ? 'Awaiting next session...' : 'Select a meeting'}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ─── Agent Seats ─── */}
                {SEATS.map(seat => {
                  const agent = AGENTS[seat.id]
                  if (!agent) return null
                  const isActive = seat.id === activeAgentId
                  const stance = agentStances[seat.id]
                  const isOrch = seat.id === 'orchestrator'
                  const size = isOrch ? 50 : 42

                  return (
                    <div key={seat.id} className="absolute z-10" style={{
                      top: `${seat.top}%`, left: `${seat.left}%`,
                      transform: 'translate(-50%, -50%)',
                    }}>
                      <div
                        className="flex flex-col items-center cursor-pointer group"
                        onClick={() => {
                          const idx = speakMsgs.findIndex(m => m.agent === seat.id)
                          if (idx >= 0) { setActiveStep(idx); setIsPlaying(false) }
                        }}
                      >
                        {/* Seat Circle */}
                        <div className="relative">
                          <div
                            className={isActive ? 'seat-pulse' : ''}
                            style={{
                              width: size, height: size, borderRadius: '50%',
                              background: isActive ? 'var(--bg-2)' : 'var(--bg-1)',
                              border: `2px solid ${isActive ? agent.color : 'var(--border)'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: isOrch ? 24 : 18,
                              transition: 'all 0.4s ease',
                              '--pulse-clr': `${agent.color}50`,
                              filter: isActive ? `drop-shadow(0 0 8px ${agent.color})` : 'none',
                            } as React.CSSProperties}
                          >
                            {agent.icon}
                          </div>
                          {/* Stance indicator dot */}
                          {stance && stance !== 'neutral' && (
                            <div className="absolute -bottom-0.5 -right-0.5" style={{
                              width: 10, height: 10, borderRadius: '50%',
                              background: stance === 'bull' ? 'var(--green)' : 'var(--red)',
                              border: '2px solid var(--bg-0)',
                              boxShadow: `0 0 4px ${stance === 'bull' ? 'var(--green)' : 'var(--red)'}`,
                            }} />
                          )}
                        </div>

                        {/* Name */}
                        <span className="text-[8px] font-bold mt-0.5 whitespace-nowrap" style={{
                          color: isActive ? agent.color : 'var(--text-3)',
                          transition: 'color 0.3s ease',
                          textShadow: isActive ? `0 0 10px ${agent.color}` : 'none',
                        }}>
                          {agent.name}
                        </span>

                        {/* Chairman label for Orchestrator */}
                        {isOrch && (
                          <span className="text-[6px] tracking-[0.15em] font-bold" style={{ color: 'var(--amber)', opacity: 0.45 }}>
                            CHAIRMAN
                          </span>
                        )}

                        {/* Title tooltip on hover */}
                        <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-[7px] font-bold px-2 py-0.5 rounded whitespace-nowrap" style={{
                          background: 'var(--bg-3)',
                          color: agent.color,
                          border: '1px solid var(--border)',
                          bottom: '100%', marginBottom: 4,
                          zIndex: 20,
                        }}>
                          {agent.title}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* ─── Active Speaker Message Panel ─── */}
              {activeMsg && (
                <div className="mx-3 mb-1 flex-shrink-0 rounded-lg overflow-hidden msg-fade" key={activeStep} style={{
                  background: 'var(--bg-1)',
                  border: '1px solid var(--border)',
                  borderLeftWidth: 3,
                  borderLeftColor: AGENTS[activeMsg.agent]?.color ?? 'var(--border)',
                }}>
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{AGENTS[activeMsg.agent]?.icon}</span>
                      <span className="text-[10px] font-bold" style={{ color: AGENTS[activeMsg.agent]?.color }}>
                        {AGENTS[activeMsg.agent]?.name ?? activeMsg.agent}
                      </span>
                      <span className="text-[7px] font-bold px-1.5 py-0.5 rounded" style={{
                        background: ROLE_BADGE[activeMsg.role]?.bg ?? 'var(--bg-2)',
                        color: activeMsg.role === 'decision' ? '#000' : 'var(--text-2)',
                      }}>
                        {ROLE_BADGE[activeMsg.role]?.label ?? 'SPEAK'}
                      </span>
                      <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{fmtTimeSec(activeMsg.created_at)}</span>
                      <button onClick={() => { setExpandedMsg(p => !p); if (!expandedMsg) setIsPlaying(false) }} className="ml-auto text-[8px] hover:opacity-80" style={{ color: 'var(--text-3)' }}>
                        {expandedMsg ? '▲ less' : '▼ more'}
                      </button>
                    </div>
                    <div className="text-[10px] leading-relaxed" style={{
                      color: activeMsg.role === 'decision' ? 'var(--text-0)' : 'var(--text-1)',
                      display: expandedMsg ? undefined : '-webkit-box',
                      WebkitLineClamp: expandedMsg ? undefined : 3,
                      WebkitBoxOrient: expandedMsg ? undefined : 'vertical' as const,
                      overflow: expandedMsg ? undefined : 'hidden',
                    }}>
                      {activeMsg.message}
                    </div>
                    {activeMsg.role === 'decision' && activeMsg.data && (
                      <div className="flex items-center gap-3 mt-1.5 text-[9px]">
                        <span className="font-bold" style={{ color: 'var(--green)' }}>FOR: {String(activeMsg.data.votesFor ?? '?')}</span>
                        <span className="font-bold" style={{ color: 'var(--red)' }}>AGAINST: {String(activeMsg.data.votesAgainst ?? '?')}</span>
                        <span className="font-bold" style={{ color: activeMsg.data.execute ? 'var(--green)' : 'var(--red)' }}>
                          {activeMsg.data.execute ? '✓ EXECUTED' : '✕ REJECTED'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── Playback Controls ─── */}
              <div className="flex items-center justify-center gap-2 px-4 py-1.5 flex-shrink-0" style={{
                borderTop: '1px solid var(--border)', background: 'var(--bg-1)',
              }}>
                <button
                  onClick={() => setActiveStep(s => Math.max(0, s - 1))}
                  disabled={speakMsgs.length === 0}
                  className="text-[9px] font-bold px-2.5 py-1 rounded hover:opacity-80 disabled:opacity-30"
                  style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                >◀</button>

                {/* Progress Dots */}
                <div className="flex items-center gap-[3px] mx-1">
                  {speakMsgs.slice(0, 30).map((m, i) => (
                    <div key={i} onClick={() => setActiveStep(i)} className="cursor-pointer rounded-full transition-all" style={{
                      width: i === activeStep ? 10 : 4,
                      height: 4,
                      borderRadius: 2,
                      background: i === activeStep
                        ? (AGENTS[m.agent]?.color ?? 'var(--amber)')
                        : i < activeStep ? 'var(--text-3)' : 'var(--bg-3)',
                    }} />
                  ))}
                  {speakMsgs.length > 30 && (
                    <span className="text-[7px] ml-1" style={{ color: 'var(--text-3)' }}>+{speakMsgs.length - 30}</span>
                  )}
                </div>

                <button
                  onClick={() => setActiveStep(s => Math.min(speakMsgs.length - 1, s + 1))}
                  disabled={speakMsgs.length === 0}
                  className="text-[9px] font-bold px-2.5 py-1 rounded hover:opacity-80 disabled:opacity-30"
                  style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                >▶</button>

                <div className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />

                <span className="text-[8px] font-mono min-w-[36px] text-center" style={{ color: 'var(--text-3)' }}>
                  {speakMsgs.length > 0 ? `${activeStep + 1}/${speakMsgs.length}` : '—'}
                </span>

                <div className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />

                <button
                  onClick={() => setIsPlaying(p => !p)}
                  disabled={speakMsgs.length === 0}
                  className="text-[9px] font-bold px-3 py-1 rounded hover:opacity-80 disabled:opacity-30"
                  style={{
                    background: isPlaying ? 'rgba(255,51,102,0.12)' : 'rgba(0,255,163,0.12)',
                    color: isPlaying ? 'var(--red)' : 'var(--green)',
                    border: `1px solid ${isPlaying ? 'rgba(255,51,102,0.25)' : 'rgba(0,255,163,0.25)'}`,
                  }}
                >
                  {isPlaying ? '⏸ PAUSE' : '▶ PLAY'}
                </button>

                <span className="text-[7px] ml-2 hidden sm:inline" style={{ color: 'var(--text-3)' }}>
                  ← → Space
                </span>
              </div>
            </div>
          ) : (
            /* ═══ TRANSCRIPT VIEW ═══ */
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
              {displayMsgs.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center" style={{ color: 'var(--text-3)' }}>
                    <div className="text-3xl mb-2">🏛</div>
                    <div className="text-[13px] font-bold mb-1">Agent War Room</div>
                    <div className="text-[11px]">
                      {meetings.length === 0
                        ? 'No meetings yet. The War Room activates every 30 minutes when the cron runs.'
                        : 'Select a meeting from the left panel.'}
                    </div>
                  </div>
                </div>
              )}

              {displayMsgs.map((msg, i) => {
                const agent = AGENTS[msg.agent] ?? { icon: '⚡', name: msg.agent, color: 'var(--text-2)', title: '' }
                const role = ROLE_BADGE[msg.role] ?? ROLE_BADGE.speak
                const t = fmtTimeSec(msg.created_at)
                const isDecision = msg.role === 'decision'

                if (msg.role === 'open' || msg.role === 'close') {
                  return (
                    <div key={i} className="text-center py-2">
                      <span className="text-[10px] px-3 py-1 rounded-full" style={{
                        background: 'var(--bg-2)',
                        color: msg.role === 'open' ? 'var(--text-2)' : 'var(--text-3)',
                      }}>
                        {msg.role === 'open' && agent.icon} {msg.message}
                      </span>
                    </div>
                  )
                }

                return (
                  <div key={i} className="flex gap-2 py-1.5 rounded px-2 transition-colors" style={{
                    background: isDecision ? 'var(--bg-2)' : 'transparent',
                    borderLeft: isDecision ? '3px solid var(--amber)' : '3px solid transparent',
                  }}>
                    <div className="flex-shrink-0 w-7 text-center text-lg pt-0.5">{agent.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.name}</span>
                        <span className="text-[7px] font-bold px-1.5 py-0.5 rounded" style={{
                          background: role.bg, color: isDecision ? '#000' : 'var(--text-2)',
                        }}>{role.label}</span>
                        <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{t}</span>
                      </div>
                      <div className="text-[11px] leading-relaxed" style={{ color: isDecision ? 'var(--text-0)' : 'var(--text-1)' }}>
                        {msg.message}
                      </div>
                      {isDecision && msg.data && (
                        <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                          <span className="font-bold" style={{ color: 'var(--green)' }}>FOR: {String(msg.data.votesFor ?? '?')}</span>
                          <span className="font-bold" style={{ color: 'var(--red)' }}>AGAINST: {String(msg.data.votesAgainst ?? '?')}</span>
                          <span style={{ color: 'var(--text-3)' }}>| {String(msg.data.agentCount ?? 12)} agents</span>
                          <span className="font-bold" style={{ color: msg.data.execute ? 'var(--green)' : 'var(--red)' }}>
                            {msg.data.execute ? 'TRADE EXECUTED' : 'TRADE REJECTED'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
