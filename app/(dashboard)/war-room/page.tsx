'use client'
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'

/* ═══════════════════════════════════════════════════════════════════════════════
   AGENT CONFIG
   ═══════════════════════════════════════════════════════════════════════════════ */

const AGENTS: Record<string, { icon: string; name: string; color: string; title: string; ring: number }> = {
  'orchestrator':       { icon: '🧠', name: 'Orchestrator',  color: '#ffcc00', title: 'Predsjedavajući',    ring: 0 },
  'macro-agent':        { icon: '🌍', name: 'Macro',         color: '#00ccff', title: 'Makro Analitičar',   ring: 1 },
  'correlation-agent':  { icon: '🔗', name: 'Korelacija',    color: '#6fa8ff', title: 'Cross-Asset',        ring: 1 },
  'bull-agent':         { icon: '🐂', name: 'Bull',          color: '#00ffa3', title: 'Bullish Advokat',    ring: 1 },
  'bear-agent':         { icon: '🐻', name: 'Bear',          color: '#ff3366', title: 'Bearish Advokat',    ring: 1 },
  'scalper-agent':      { icon: '⚡', name: 'Scalper',       color: '#ff9900', title: 'Scalp Trader',       ring: 1 },
  'trend-agent':        { icon: '📈', name: 'Trend',         color: '#6fa8ff', title: 'Trend Follower',     ring: 1 },
  'market-analyst':     { icon: '📰', name: 'Analyst',       color: '#9966ff', title: 'Sentiment Analyst',  ring: 1 },
  'signal-generator':   { icon: '🎯', name: 'Signal',        color: '#00ffa3', title: 'Signal Generator',   ring: 1 },
  'risk-manager':       { icon: '🛡', name: 'Risk',          color: '#ff3366', title: 'Risk Manager',       ring: 1 },
  'trade-reviewer':     { icon: '📊', name: 'Reviewer',      color: '#ffcc00', title: 'Trade Reviewer',     ring: 1 },
  'master-agent':       { icon: '👑', name: 'Master',        color: '#ffcc00', title: 'Master Agent',       ring: 1 },
}

const SEAT_ANGLES: { id: string; angle: number }[] = [
  { id: 'macro-agent',       angle: -90 },
  { id: 'correlation-agent', angle: -60 },
  { id: 'bull-agent',        angle: -30 },
  { id: 'bear-agent',        angle: 0 },
  { id: 'scalper-agent',     angle: 30 },
  { id: 'trend-agent',       angle: 60 },
  { id: 'market-analyst',    angle: 90 },
  { id: 'signal-generator',  angle: 120 },
  { id: 'risk-manager',      angle: 150 },
  { id: 'trade-reviewer',    angle: 180 },
  { id: 'master-agent',      angle: -120 },
]

/* ═══════════════════════════════════════════════════════════════════════════════
   TYPES + HELPERS
   ═══════════════════════════════════════════════════════════════════════════════ */

interface Msg { id: string; meeting_id: string; agent: string; role: string; message: string; instrument: string; created_at: string; data?: Record<string, unknown> }
interface Meeting { id: string; instrument: string; messageCount: number; startedAt: string; decision: string; messages: Msg[] }

function getStance(message: string): 'bull' | 'bear' | 'neutral' {
  const l = message.toLowerCase()
  const bu = ['long', 'bullish', 'buy', 'upside', 'bounce', 'rally', 'recovery', 'accumulation', 'approve', 'execute', 'support'].filter(w => l.includes(w)).length
  const be = ['short', 'bearish', 'sell', 'downside', 'breakdown', 'drop', 'correction', 'decline', 'reject', 'caution', 'against'].filter(w => l.includes(w)).length
  return bu > be ? 'bull' : be > bu ? 'bear' : 'neutral'
}

function getConfidence(message: string): number | null {
  const m = message.match(/(\d{2,3})%?\s*(?:confiden|sigurn)/i) ?? message.match(/(?:confiden|sigurn)\w*\s*(?:of\s+)?(\d{2,3})/i)
  if (m) return Math.min(parseInt(m[1]), 100)
  return null
}

function fmtTime(d: string) {
  return d ? new Date(d).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '—'
}

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString('en', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short' }) : ''
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

function extractPrice(msg: Msg): string | null {
  const m = msg.message.match(/\$[\d,]+\.?\d*/g)
  return m?.[0] ?? null
}

/* ═══════════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════════ */

export default function WarRoomPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [allMsgs, setAllMsgs] = useState<Msg[]>([])
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeStep, setActiveStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/war-room?limit=20').then(r => r.json()).then(d => {
      setMeetings(d.meetings ?? [])
      setAllMsgs(d.data ?? [])
      if (d.meetings?.length) setSelectedMeeting(d.meetings[0].id)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const currentMeeting = meetings.find(m => m.id === selectedMeeting)
  const displayMsgs = currentMeeting?.messages ?? allMsgs.filter(m => m.meeting_id === selectedMeeting)
  const speakMsgs = useMemo(() => displayMsgs.filter(m => m.role === 'speak' || m.role === 'decision'), [displayMsgs])
  const visibleMsgs = useMemo(() => speakMsgs.slice(0, activeStep + 1), [speakMsgs, activeStep])
  const activeMsg = speakMsgs[activeStep]
  const activeAgentId = activeMsg?.agent

  const agentStances = useMemo(() => {
    const s: Record<string, { stance: 'bull' | 'bear' | 'neutral'; conf: number | null }> = {}
    for (const msg of visibleMsgs) {
      if (msg.agent && msg.role === 'speak') {
        s[msg.agent] = { stance: getStance(msg.message), conf: getConfidence(msg.message) }
      }
    }
    return s
  }, [visibleMsgs])

  const decisionMsg = useMemo(() => displayMsgs.find(m => m.role === 'decision'), [displayMsgs])
  const openMsg = useMemo(() => displayMsgs.find(m => m.role === 'open'), [displayMsgs])
  const closeMsg = useMemo(() => displayMsgs.find(m => m.role === 'close'), [displayMsgs])

  const voteSummary = useMemo(() => {
    let f = 0, a = 0
    for (const m of visibleMsgs) {
      if (m.role !== 'speak') continue
      const st = getStance(m.message)
      if (st === 'bull') f++
      else if (st === 'bear') a++
    }
    return { votesFor: f, votesAgainst: a }
  }, [visibleMsgs])

  const decisionVotesFor = Number(decisionMsg?.data?.votesFor ?? voteSummary.votesFor)
  const decisionVotesAgainst = Number(decisionMsg?.data?.votesAgainst ?? voteSummary.votesAgainst)

  useEffect(() => { setActiveStep(0); setIsPlaying(false) }, [selectedMeeting])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [activeStep])

  useEffect(() => {
    if (!isPlaying) return
    const timer = setInterval(() => {
      setActiveStep(s => {
        if (s >= speakMsgs.length - 1) { setIsPlaying(false); return s }
        return s + 1
      })
    }, 3500)
    return () => clearInterval(timer)
  }, [isPlaying, speakMsgs.length])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'ArrowRight') setActiveStep(s => Math.min(s + 1, Math.max(speakMsgs.length - 1, 0)))
    else if (e.key === 'ArrowLeft') setActiveStep(s => Math.max(s - 1, 0))
    else if (e.key === ' ') { e.preventDefault(); setIsPlaying(p => !p) }
  }, [speakMsgs.length])
  useEffect(() => { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onKey])

  return (
    <>
      <style>{`
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--pulse-clr, transparent); }
          50% { box-shadow: 0 0 24px 6px var(--pulse-clr, transparent); }
        }
        @keyframes speakGlow {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ringRotate {
          from { transform: translate(-50%,-50%) rotate(0deg); }
          to { transform: translate(-50%,-50%) rotate(360deg); }
        }
        @keyframes tablePulse {
          0%, 100% { box-shadow: inset 0 0 80px rgba(0,0,0,0.6), 0 0 50px rgba(255,204,0,0.015); }
          50% { box-shadow: inset 0 0 50px rgba(0,0,0,0.4), 0 0 80px rgba(255,204,0,0.04); }
        }
        .speak-glow { animation: speakGlow 1.5s ease-in-out infinite; }
        .chat-msg { animation: fadeSlideIn 0.35s ease-out; }
        .table-pulse { animation: tablePulse 6s ease-in-out infinite; }
        .seat-active { animation: glowPulse 2s ease-in-out infinite; }
        .scroll-thin::-webkit-scrollbar { width: 4px; }
        .scroll-thin::-webkit-scrollbar-track { background: transparent; }
        .scroll-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
      `}</style>

      <div className="h-full flex" style={{ background: '#050510' }}>
        {/* ═══ LEFT SIDEBAR — Sessions ═══ */}
        <div className="w-56 flex-shrink-0 overflow-y-auto scroll-thin" style={{
          background: 'linear-gradient(180deg, #0a0a18 0%, #060612 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div className="px-3 py-3">
            <div className="text-[9px] font-bold tracking-[0.2em] mb-3" style={{ color: 'rgba(255,204,0,0.5)' }}>
              SESIJE
            </div>
            {loading && <div className="text-[10px] p-2" style={{ color: 'rgba(255,255,255,0.3)' }}>Učitavanje...</div>}
            {!loading && meetings.length === 0 && (
              <div className="text-[10px] p-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Nema sesija. Pokreni cron da startaš War Room.
              </div>
            )}
            {meetings.map(m => {
              const status = meetingStatus(m)
              const isActive = selectedMeeting === m.id
              const statusClr = status === 'executed' ? '#00ffa3' : status === 'rejected' ? '#ff3366' : 'rgba(255,255,255,0.25)'
              return (
                <button key={m.id} onClick={() => setSelectedMeeting(m.id)} className="w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-all" style={{
                  background: isActive ? 'rgba(255,204,0,0.06)' : 'transparent',
                  border: isActive ? '1px solid rgba(255,204,0,0.15)' : '1px solid transparent',
                }}>
                  <div className="flex items-center gap-2">
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', background: statusClr, flexShrink: 0,
                      boxShadow: status !== 'pending' ? `0 0 8px ${statusClr}` : 'none',
                    }} />
                    <span className="text-[12px] font-bold" style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                      {m.instrument}
                    </span>
                    <span className="text-[8px] ml-auto" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {m.messageCount} msg
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {fmtDate(m.startedAt)} {fmtTime(m.startedAt)}
                    </span>
                  </div>
                  {m.decision && (
                    <div className="text-[8px] mt-1 truncate" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      {m.decision.slice(0, 60)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ═══ CENTER — Boardroom ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{
          background: 'radial-gradient(ellipse at 50% 45%, #0d0d1a 0%, #050510 70%)',
        }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-2 flex-shrink-0" style={{
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(10,10,24,0.8)',
          }}>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold tracking-[0.15em]" style={{ color: '#ffcc00' }}>WAR ROOM</span>
              {currentMeeting && (
                <>
                  <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
                  <span className="text-[13px] font-bold" style={{ color: '#fff' }}>{currentMeeting.instrument}</span>
                  <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {fmtDate(currentMeeting.startedAt)} {fmtTime(currentMeeting.startedAt)} Dubai
                  </span>
                </>
              )}
            </div>
            {currentMeeting && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold" style={{ color: '#00ffa3' }}>{voteSummary.votesFor} ZA</span>
                  <div style={{ width: 40, height: 3, borderRadius: 2, background: 'rgba(255,51,102,0.3)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${(voteSummary.votesFor + voteSummary.votesAgainst) > 0 ? (voteSummary.votesFor / (voteSummary.votesFor + voteSummary.votesAgainst)) * 100 : 50}%`,
                      height: '100%', background: '#00ffa3', borderRadius: 2,
                    }} />
                  </div>
                  <span className="text-[9px] font-bold" style={{ color: '#ff3366' }}>{voteSummary.votesAgainst} PROTIV</span>
                </div>
              </div>
            )}
          </div>

          {/* Boardroom + Chat split */}
          <div className="flex-1 flex overflow-hidden">
            {/* ─── Boardroom Visualization ─── */}
            <div className="flex-1 relative overflow-hidden" style={{ minWidth: 0 }}>
              {/* Oval Table */}
              <div className="absolute table-pulse" style={{
                top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: '52%', height: '55%', borderRadius: '50%',
                background: 'radial-gradient(ellipse at 50% 40%, #151520 0%, #0c0c16 50%, #08080f 100%)',
                border: '1px solid rgba(255,204,0,0.08)',
              }}>
                {/* Inner ring */}
                <div className="absolute" style={{
                  inset: '12%', borderRadius: '50%',
                  border: '1px solid rgba(255,204,0,0.03)',
                }} />
                {/* Center info */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
                  {currentMeeting ? (
                    <>
                      <div className="text-[7px] tracking-[0.3em] font-bold mb-1" style={{ color: 'rgba(255,204,0,0.35)' }}>
                        {activeMsg ? 'GOVORI' : 'SESIJA'}
                      </div>
                      {activeMsg && (
                        <div className="text-lg mb-1" style={{ color: AGENTS[activeMsg.agent]?.color ?? '#fff' }}>
                          {AGENTS[activeMsg.agent]?.icon}
                        </div>
                      )}
                      <div className="text-[18px] font-bold" style={{ color: '#fff', letterSpacing: '0.04em' }}>
                        {currentMeeting.instrument}
                      </div>
                      {openMsg && extractPrice(openMsg) && (
                        <div className="text-[11px] font-mono mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          @ {extractPrice(openMsg)}
                        </div>
                      )}
                      {/* Live vote bar */}
                      <div className="flex items-center gap-3 mt-3">
                        <span className="text-[20px] font-bold" style={{ color: '#00ffa3' }}>{voteSummary.votesFor}</span>
                        <div style={{ width: 60, height: 4, borderRadius: 2, background: 'rgba(255,51,102,0.25)', overflow: 'hidden' }}>
                          <div style={{
                            width: `${(voteSummary.votesFor + voteSummary.votesAgainst) > 0 ? (voteSummary.votesFor / (voteSummary.votesFor + voteSummary.votesAgainst)) * 100 : 50}%`,
                            height: '100%', background: '#00ffa3', borderRadius: 2, transition: 'width 0.5s ease',
                          }} />
                        </div>
                        <span className="text-[20px] font-bold" style={{ color: '#ff3366' }}>{voteSummary.votesAgainst}</span>
                      </div>
                      {/* Final decision badge */}
                      {activeStep >= speakMsgs.length - 1 && decisionMsg && (
                        <div className="mt-3 text-[9px] font-bold px-4 py-1.5 rounded-full" style={{
                          background: decisionMsg.data?.execute ? 'rgba(0,255,163,0.1)' : 'rgba(255,51,102,0.1)',
                          color: decisionMsg.data?.execute ? '#00ffa3' : '#ff3366',
                          border: `1px solid ${decisionMsg.data?.execute ? 'rgba(0,255,163,0.25)' : 'rgba(255,51,102,0.25)'}`,
                          letterSpacing: '0.15em',
                        }}>
                          {decisionMsg.data?.execute ? '✓ ODOBRENO' : '✕ ODBIJENO'}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-[36px] mb-2 opacity-20">⚔</div>
                      <div className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {meetings.length === 0 ? 'Čeka se sesija...' : 'Izaberi sesiju'}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Orchestrator at bottom center */}
              <SeatNode
                agent={AGENTS['orchestrator']!}
                agentId="orchestrator"
                isActive={activeAgentId === 'orchestrator'}
                stanceInfo={agentStances['orchestrator']}
                style={{ position: 'absolute', bottom: '3%', left: '50%', transform: 'translate(-50%, 0)' }}
                isOrchestrator
                onClick={() => { const idx = speakMsgs.findIndex(m => m.agent === 'orchestrator'); if (idx >= 0) { setActiveStep(idx); setIsPlaying(false) } }}
              />

              {/* Agent seats in elliptical ring */}
              {SEAT_ANGLES.map(({ id, angle }) => {
                const agent = AGENTS[id]
                if (!agent) return null
                const rad = (angle * Math.PI) / 180
                const rx = 44, ry = 40
                const cx = 50, cy = 46
                const x = cx + rx * Math.cos(rad)
                const y = cy + ry * Math.sin(rad)

                return (
                  <SeatNode
                    key={id}
                    agent={agent}
                    agentId={id}
                    isActive={activeAgentId === id}
                    stanceInfo={agentStances[id]}
                    style={{ position: 'absolute', top: `${y}%`, left: `${x}%`, transform: 'translate(-50%, -50%)' }}
                    onClick={() => { const idx = speakMsgs.findIndex(m => m.agent === id); if (idx >= 0) { setActiveStep(idx); setIsPlaying(false) } }}
                  />
                )
              })}

              {/* Connection line from active agent to center */}
              {activeMsg && activeAgentId !== 'orchestrator' && (() => {
                const seat = SEAT_ANGLES.find(s => s.id === activeAgentId)
                if (!seat) return null
                const rad = (seat.angle * Math.PI) / 180
                const x = 50 + 44 * Math.cos(rad)
                const y = 46 + 40 * Math.sin(rad)
                return (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                    <line x1={`${x}%`} y1={`${y}%`} x2="50%" y2="50%"
                      stroke={AGENTS[activeAgentId]?.color ?? '#fff'} strokeWidth="1" strokeDasharray="4 4" opacity="0.2" />
                  </svg>
                )
              })()}
            </div>

            {/* ═══ RIGHT PANEL — Chat Box ═══ */}
            <div className="w-[380px] flex-shrink-0 flex flex-col" style={{
              borderLeft: '1px solid rgba(255,255,255,0.06)',
              background: 'linear-gradient(180deg, #0a0a18 0%, #08080f 100%)',
            }}>
              {/* Chat header */}
              <div className="px-4 py-2.5 flex items-center justify-between flex-shrink-0" style={{
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    DISKUSIJA
                  </span>
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{
                    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)',
                  }}>
                    {activeStep + 1}/{speakMsgs.length}
                  </span>
                </div>
                <button
                  onClick={() => setIsPlaying(p => !p)}
                  className="text-[8px] font-bold px-3 py-1 rounded-full transition-all"
                  style={{
                    background: isPlaying ? 'rgba(255,51,102,0.12)' : 'rgba(0,255,163,0.12)',
                    color: isPlaying ? '#ff3366' : '#00ffa3',
                    border: `1px solid ${isPlaying ? 'rgba(255,51,102,0.2)' : 'rgba(0,255,163,0.2)'}`,
                  }}
                >
                  {isPlaying ? '⏸ PAUZA' : '▶ POKRENI'}
                </button>
              </div>

              {/* Opening context */}
              {openMsg && (
                <div className="px-4 py-2 flex-shrink-0" style={{
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: 'rgba(255,204,0,0.03)',
                }}>
                  <div className="text-[8px] font-bold tracking-[0.1em] mb-1" style={{ color: 'rgba(255,204,0,0.5)' }}>
                    KONTEKST SESIJE
                  </div>
                  <div className="text-[10px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {openMsg.message}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              <div ref={chatRef} className="flex-1 overflow-y-auto scroll-thin px-3 py-2 space-y-1">
                {visibleMsgs.length === 0 && (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center" style={{ color: 'rgba(255,255,255,0.15)' }}>
                      <div className="text-2xl mb-2">💬</div>
                      <div className="text-[10px]">Pritisni ▶ za replay diskusije</div>
                    </div>
                  </div>
                )}

                {visibleMsgs.map((msg, i) => {
                  const agent = AGENTS[msg.agent] ?? { icon: '⚡', name: msg.agent, color: '#666', title: '', ring: 1 }
                  const stance = getStance(msg.message)
                  const conf = getConfidence(msg.message)
                  const isDecision = msg.role === 'decision'
                  const isLast = i === visibleMsgs.length - 1

                  return (
                    <div key={msg.id ?? i} className={`chat-msg rounded-lg px-3 py-2 ${isLast ? '' : ''}`} style={{
                      background: isDecision ? 'rgba(255,204,0,0.06)' : isLast ? 'rgba(255,255,255,0.03)' : 'transparent',
                      border: isDecision ? '1px solid rgba(255,204,0,0.15)' : '1px solid transparent',
                    }}>
                      {/* Agent header */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{agent.icon}</span>
                        <span className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.name}</span>
                        {/* Stance badge */}
                        {!isDecision && stance !== 'neutral' && (
                          <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{
                            background: stance === 'bull' ? 'rgba(0,255,163,0.1)' : 'rgba(255,51,102,0.1)',
                            color: stance === 'bull' ? '#00ffa3' : '#ff3366',
                            border: `1px solid ${stance === 'bull' ? 'rgba(0,255,163,0.2)' : 'rgba(255,51,102,0.2)'}`,
                          }}>
                            {stance === 'bull' ? '▲ BULL' : '▼ BEAR'}
                          </span>
                        )}
                        {/* Confidence badge */}
                        {conf && (
                          <span className="text-[7px] font-bold font-mono px-1.5 py-0.5 rounded-full" style={{
                            background: conf >= 70 ? 'rgba(0,255,163,0.08)' : conf >= 50 ? 'rgba(255,204,0,0.08)' : 'rgba(255,51,102,0.08)',
                            color: conf >= 70 ? '#00ffa3' : conf >= 50 ? '#ffcc00' : '#ff3366',
                          }}>
                            {conf}%
                          </span>
                        )}
                        {isDecision && (
                          <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{
                            background: 'rgba(255,204,0,0.15)', color: '#ffcc00',
                          }}>
                            ODLUKA
                          </span>
                        )}
                        <span className="text-[7px] ml-auto" style={{ color: 'rgba(255,255,255,0.15)' }}>
                          {fmtTimeSec(msg.created_at)}
                        </span>
                      </div>

                      {/* Message body */}
                      <div className="text-[10px] leading-[1.6]" style={{
                        color: isDecision ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)',
                      }}>
                        {msg.message}
                      </div>

                      {/* Decision metadata */}
                      {isDecision && msg.data && (
                        <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold" style={{ color: '#00ffa3' }}>{String(msg.data.votesFor ?? decisionVotesFor)}</span>
                            <span className="text-[7px]" style={{ color: 'rgba(255,255,255,0.25)' }}>ZA</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold" style={{ color: '#ff3366' }}>{String(msg.data.votesAgainst ?? decisionVotesAgainst)}</span>
                            <span className="text-[7px]" style={{ color: 'rgba(255,255,255,0.25)' }}>PROTIV</span>
                          </div>
                          <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{
                            background: msg.data.execute ? 'rgba(0,255,163,0.15)' : 'rgba(255,51,102,0.15)',
                            color: msg.data.execute ? '#00ffa3' : '#ff3366',
                          }}>
                            {msg.data.execute ? '✓ ODOBRENO' : '✕ ODBIJENO'}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Close message */}
                {activeStep >= speakMsgs.length - 1 && closeMsg && (
                  <div className="chat-msg text-center py-3">
                    <div className="inline-block text-[9px] px-4 py-1.5 rounded-full" style={{
                      background: 'rgba(255,255,255,0.03)',
                      color: 'rgba(255,255,255,0.3)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      {closeMsg.message}
                    </div>
                  </div>
                )}
              </div>

              {/* Playback controls */}
              <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{
                borderTop: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(10,10,24,0.8)',
              }}>
                <button onClick={() => setActiveStep(0)} className="text-[8px] px-2 py-1 rounded" style={{
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
                }}>⏮</button>
                <button onClick={() => setActiveStep(s => Math.max(0, s - 1))} className="text-[8px] px-2 py-1 rounded" style={{
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
                }}>◀</button>

                {/* Mini progress bar */}
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const pct = (e.clientX - rect.left) / rect.width
                    setActiveStep(Math.round(pct * (speakMsgs.length - 1)))
                  }}
                >
                  <div style={{
                    width: speakMsgs.length > 0 ? `${((activeStep + 1) / speakMsgs.length) * 100}%` : '0%',
                    height: '100%', borderRadius: 4, transition: 'width 0.3s ease',
                    background: activeMsg ? (AGENTS[activeMsg.agent]?.color ?? '#ffcc00') : '#ffcc00',
                  }} />
                </div>

                <button onClick={() => setActiveStep(s => Math.min(speakMsgs.length - 1, s + 1))} className="text-[8px] px-2 py-1 rounded" style={{
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
                }}>▶</button>
                <button onClick={() => setActiveStep(speakMsgs.length - 1)} className="text-[8px] px-2 py-1 rounded" style={{
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
                }}>⏭</button>

                <span className="text-[7px] font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>
                  ←→ Space
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SEAT NODE — Individual agent around the table
   ═══════════════════════════════════════════════════════════════════════════════ */

function SeatNode({ agent, agentId, isActive, stanceInfo, style, isOrchestrator, onClick }: {
  agent: typeof AGENTS[string]
  agentId: string
  isActive: boolean
  stanceInfo?: { stance: 'bull' | 'bear' | 'neutral'; conf: number | null }
  style: React.CSSProperties
  isOrchestrator?: boolean
  onClick: () => void
}) {
  const size = isOrchestrator ? 52 : 40
  const stance = stanceInfo?.stance
  const conf = stanceInfo?.conf

  return (
    <div style={{ ...style, zIndex: isActive ? 20 : 10 }}>
      <div className="flex flex-col items-center cursor-pointer group" onClick={onClick}>
        {/* Confidence arc — shown if agent has spoken */}
        {conf && !isOrchestrator && (
          <div className="absolute -top-1 text-[7px] font-bold font-mono px-1 py-0.5 rounded" style={{
            color: conf >= 70 ? '#00ffa3' : conf >= 50 ? '#ffcc00' : '#ff3366',
            background: 'rgba(0,0,0,0.6)',
          }}>
            {conf}%
          </div>
        )}

        {/* Main circle */}
        <div className="relative">
          <div className={isActive ? 'seat-active' : ''} style={{
            width: size, height: size, borderRadius: '50%',
            background: isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
            border: `2px solid ${isActive ? agent.color : 'rgba(255,255,255,0.08)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: isOrchestrator ? 22 : 16,
            transition: 'all 0.4s ease',
            '--pulse-clr': `${agent.color}40`,
            filter: isActive ? `drop-shadow(0 0 12px ${agent.color})` : 'none',
          } as React.CSSProperties}>
            {agent.icon}
          </div>

          {/* Speaking indicator */}
          {isActive && (
            <div className="absolute -top-1 -right-1 speak-glow" style={{
              width: 10, height: 10, borderRadius: '50%',
              background: agent.color, border: '2px solid #050510',
            }} />
          )}

          {/* Stance dot */}
          {stance && stance !== 'neutral' && !isActive && (
            <div className="absolute -bottom-0.5 -right-0.5" style={{
              width: 10, height: 10, borderRadius: '50%',
              background: stance === 'bull' ? '#00ffa3' : '#ff3366',
              border: '2px solid #050510',
              boxShadow: `0 0 6px ${stance === 'bull' ? '#00ffa3' : '#ff3366'}`,
            }} />
          )}
        </div>

        {/* Name + title */}
        <span className="text-[8px] font-bold mt-1 whitespace-nowrap" style={{
          color: isActive ? agent.color : 'rgba(255,255,255,0.35)',
          textShadow: isActive ? `0 0 10px ${agent.color}` : 'none',
          transition: 'all 0.3s ease',
        }}>
          {agent.name}
        </span>

        {isOrchestrator && (
          <span className="text-[6px] tracking-[0.15em] font-bold" style={{ color: 'rgba(255,204,0,0.3)' }}>
            PREDSJEDAVAJUĆI
          </span>
        )}

        {/* Hover tooltip */}
        <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-[7px] font-bold px-2 py-1 rounded whitespace-nowrap" style={{
          background: 'rgba(20,20,35,0.95)',
          color: agent.color,
          border: `1px solid ${agent.color}30`,
          bottom: '100%', marginBottom: 6,
          boxShadow: `0 4px 12px rgba(0,0,0,0.4)`,
        }}>
          {agent.title}
        </div>
      </div>
    </div>
  )
}
