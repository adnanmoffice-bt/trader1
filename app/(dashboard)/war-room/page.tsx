'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'

const AGENTS: Record<string, { icon: string; name: string; color: string }> = {
  'orchestrator':       { icon: '🧠', name: 'Orchestrator',  color: '#ffcc00' },
  'macro-agent':        { icon: '🌍', name: 'Macro',         color: '#00ccff' },
  'correlation-agent':  { icon: '🔗', name: 'Correlation',   color: '#6fa8ff' },
  'bull-agent':         { icon: '🐂', name: 'Bull',          color: '#00ffa3' },
  'bear-agent':         { icon: '🐻', name: 'Bear',          color: '#ff3366' },
  'scalper-agent':      { icon: '⚡', name: 'Scalper',       color: '#ff9900' },
  'trend-agent':        { icon: '📈', name: 'Trend',         color: '#6fa8ff' },
  'market-analyst':     { icon: '📰', name: 'Analyst',       color: '#9966ff' },
  'signal-generator':   { icon: '🎯', name: 'Signal',        color: '#00ffa3' },
  'risk-manager':       { icon: '🛡', name: 'Risk',          color: '#ff3366' },
  'trade-reviewer':     { icon: '📊', name: 'Reviewer',      color: '#ffcc00' },
  'master-agent':       { icon: '👑', name: 'Master',        color: '#ffcc00' },
}

const TOP_ROW = ['macro-agent', 'correlation-agent', 'bull-agent', 'bear-agent', 'scalper-agent', 'trend-agent']
const BOT_ROW = ['market-analyst', 'signal-generator', 'orchestrator', 'risk-manager', 'trade-reviewer', 'master-agent']

interface Msg { id: string; meeting_id: string; agent: string; role: string; message: string; instrument: string; created_at: string; data?: Record<string, unknown> }
interface Meeting { id: string; instrument: string; messageCount: number; startedAt: string; decision: string; messages: Msg[] }

function getStance(message: string): 'bull' | 'bear' | 'neutral' {
  const l = message.toLowerCase()
  const bu = ['long', 'bullish', 'buy', 'upside', 'bounce', 'rally', 'recovery', 'accumulation', 'approve'].filter(w => l.includes(w)).length
  const be = ['short', 'bearish', 'sell', 'downside', 'breakdown', 'drop', 'correction', 'decline', 'reject'].filter(w => l.includes(w)).length
  return bu > be ? 'bull' : be > bu ? 'bear' : 'neutral'
}

function fmtTime(d: string) {
  return d ? new Date(d).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '—'
}

function fmtTimeSec(d: string) {
  return d ? new Date(d).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
}

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString('en', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short' }) : ''
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

export default function WarRoomPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [msgCache, setMsgCache] = useState<Record<string, Msg[]>>({})
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)

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
  const allDisplayMsgs = msgCache[selectedMeeting ?? ''] ?? []
  const speaks = useMemo(() => allDisplayMsgs.filter(m => m.role === 'speak' || m.role === 'decision' || m.role === 'alert'), [allDisplayMsgs])
  const decisionMsg = useMemo(() => allDisplayMsgs.find(m => m.role === 'decision'), [allDisplayMsgs])
  const activeMsg = speaks[step]
  const activeAgentId = activeMsg?.agent

  const stances = useMemo(() => {
    const s: Record<string, 'bull' | 'bear' | 'neutral'> = {}
    for (let i = 0; i <= step && i < speaks.length; i++) {
      const m = speaks[i]
      if (m.role === 'speak') s[m.agent] = getStance(m.message)
    }
    return s
  }, [speaks, step])

  const liveVotes = useMemo(() => {
    let f = 0, a = 0
    for (let i = 0; i <= step && i < speaks.length; i++) {
      if (speaks[i].role !== 'speak') continue
      const st = getStance(speaks[i].message)
      if (st === 'bull') f++; else if (st === 'bear') a++
    }
    return { f, a }
  }, [speaks, step])

  useEffect(() => { setStep(0); setPlaying(false) }, [selectedMeeting])

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
    <>
      <style>{`
        @keyframes msgIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pulse { 0%,100% { box-shadow:0 0 0 0 var(--pc,transparent) } 50% { box-shadow:0 0 14px 4px var(--pc,transparent) } }
        .msg-in { animation: msgIn .3s ease-out }
        .glow { animation: pulse 2s ease-in-out infinite }
        .scr::-webkit-scrollbar{width:3px} .scr::-webkit-scrollbar-track{background:transparent} .scr::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:2px}
      `}</style>

      <div className="h-full flex" style={{ background: '#06060f' }}>
        {/* ── Sidebar ── */}
        <div className="w-52 flex-shrink-0 overflow-y-auto scr" style={{ background: '#08081a', borderRight: '1px solid rgba(255,255,255,.06)' }}>
          <div className="p-2">
            <div className="text-[8px] font-bold tracking-[.2em] mb-2 px-1" style={{ color: 'rgba(255,204,0,.4)' }}>SESIJE</div>
            {loading && <div className="text-[10px] p-2" style={{ color: 'rgba(255,255,255,.2)' }}>Loading...</div>}
            {!loading && meetings.length === 0 && (
              <div className="text-[10px] p-2" style={{ color: 'rgba(255,255,255,.2)' }}>Nema sesija. Pokreni cron.</div>
            )}
            {meetings.map(m => {
              const st = meetingStatus(m)
              const on = selectedMeeting === m.id
              const sc = st === 'executed' ? '#00ffa3' : st === 'rejected' ? '#ff3366' : 'rgba(255,255,255,.2)'
              return (
                <button key={m.id} onClick={() => setSelectedMeeting(m.id)} className="w-full text-left px-2 py-2 rounded-lg mb-0.5 transition-all" style={{
                  background: on ? 'rgba(255,204,0,.05)' : 'transparent',
                  border: on ? '1px solid rgba(255,204,0,.12)' : '1px solid transparent',
                }}>
                  <div className="flex items-center gap-1.5">
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0, boxShadow: st !== 'pending' ? `0 0 6px ${sc}` : 'none' }} />
                    <span className="text-[11px] font-bold" style={{ color: on ? '#fff' : 'rgba(255,255,255,.6)' }}>{m.instrument}</span>
                    <span className="text-[8px] ml-auto" style={{ color: 'rgba(255,255,255,.2)' }}>{msgCache[m.id]?.length ?? m.messageCount}</span>
                  </div>
                  <div className="text-[8px] mt-0.5 pl-4" style={{ color: 'rgba(255,255,255,.25)' }}>
                    {fmtDate(m.startedAt)} {fmtTime(m.startedAt)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Main ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-1.5 flex-shrink-0" style={{ background: '#0a0a1a', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold tracking-[.12em]" style={{ color: '#ffcc00' }}>⚔ WAR ROOM</span>
              {meeting && <>
                <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,.08)' }} />
                <span className="text-[12px] font-bold" style={{ color: '#fff' }}>{meeting.instrument}</span>
                <span className="text-[8px]" style={{ color: 'rgba(255,255,255,.25)' }}>{fmtDate(meeting.startedAt)} {fmtTime(meeting.startedAt)}</span>
              </>}
            </div>
            {meeting && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold" style={{ color: '#00ffa3' }}>{liveVotes.f} ZA</span>
                <div style={{ width: 50, height: 4, borderRadius: 2, background: 'rgba(255,51,102,.25)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#00ffa3', borderRadius: 2, transition: 'width .5s' }} />
                </div>
                <span className="text-[9px] font-bold" style={{ color: '#ff3366' }}>{liveVotes.a} PROTIV</span>
              </div>
            )}
          </div>

          {/* ── Boardroom Layout ── */}
          <div className="flex-1 flex flex-col overflow-hidden px-3 py-2 gap-1">
            {/* TOP ROW — agents */}
            <div className="flex justify-center gap-1 flex-shrink-0">
              {TOP_ROW.map(id => (
                <Seat key={id} id={id} active={id === activeAgentId} stance={stances[id]}
                  onClick={() => { const i = speaks.findIndex(m => m.agent === id); if (i >= 0) { setStep(i); setPlaying(false) } }} />
              ))}
            </div>

            {/* TABLE SURFACE — the discussion happens here */}
            <div className="flex-1 flex flex-col overflow-hidden rounded-xl" style={{
              background: 'linear-gradient(180deg, rgba(16,14,10,.6) 0%, rgba(10,8,6,.7) 100%)',
              border: '1px solid rgba(255,204,0,.06)',
              boxShadow: 'inset 0 2px 30px rgba(0,0,0,.3)',
            }}>
              {/* Speaker flow — mini timeline */}
              <div className="flex items-center gap-1 px-4 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                <span className="text-[7px] font-bold tracking-[.1em] mr-1" style={{ color: 'rgba(255,255,255,.15)' }}>TOK</span>
                {speaks.map((m, i) => {
                  const a = AGENTS[m.agent]
                  const isCur = i === step
                  const isPast = i < step
                  return (
                    <button key={i} onClick={() => { setStep(i); setPlaying(false) }} title={a?.name}
                      className="transition-all" style={{
                        fontSize: isCur ? 16 : 13,
                        opacity: isCur ? 1 : isPast ? 0.6 : 0.15,
                        filter: isCur ? `drop-shadow(0 0 6px ${a?.color})` : 'none',
                        transform: isCur ? 'scale(1.2)' : 'scale(1)',
                      }}>
                      {a?.icon ?? '?'}
                    </button>
                  )
                })}
              </div>

              {/* Active Message */}
              <div className="flex-1 overflow-y-auto scr px-5 py-4">
                {loadingMsgs ? (
                  <div className="flex items-center justify-center h-full text-center">
                    <div>
                      <div className="text-2xl mb-2 animate-pulse">⏳</div>
                      <div className="text-[11px]" style={{ color: 'rgba(255,255,255,.3)' }}>Učitavam diskusiju...</div>
                    </div>
                  </div>
              ) : speaks.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-center">
                    <div>
                      <div className="text-3xl mb-2 opacity-20">⚔</div>
                      <div className="text-[11px]" style={{ color: 'rgba(255,255,255,.2)' }}>
                        {!selectedMeeting ? 'Izaberi sesiju sa lijeve strane.' : meetings.length === 0 ? 'Nema sesija. Pokreni cron.' : 'Ova sesija nema diskusiju. Probaj drugu.'}
                      </div>
                    </div>
                  </div>
                ) : activeMsg ? (
                  <div className="msg-in" key={step}>
                    {/* Agent header */}
                    <div className="flex items-center gap-2.5 mb-3">
                      <span style={{ fontSize: 28 }}>{AGENTS[activeMsg.agent]?.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold" style={{ color: AGENTS[activeMsg.agent]?.color ?? '#fff' }}>
                            {AGENTS[activeMsg.agent]?.name ?? activeMsg.agent}
                          </span>
                          {activeMsg.role === 'decision' ? (
                            <span className="text-[7px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,204,0,.15)', color: '#ffcc00' }}>ODLUKA</span>
                          ) : (() => {
                            const st = getStance(activeMsg.message)
                            return st !== 'neutral' ? (
                              <span className="text-[7px] font-bold px-2 py-0.5 rounded-full" style={{
                                background: st === 'bull' ? 'rgba(0,255,163,.1)' : 'rgba(255,51,102,.1)',
                                color: st === 'bull' ? '#00ffa3' : '#ff3366',
                                border: `1px solid ${st === 'bull' ? 'rgba(0,255,163,.2)' : 'rgba(255,51,102,.2)'}`,
                              }}>
                                {st === 'bull' ? '▲ BULLISH' : '▼ BEARISH'}
                              </span>
                            ) : null
                          })()}
                        </div>
                        <span className="text-[8px]" style={{ color: 'rgba(255,255,255,.2)' }}>{fmtTimeSec(activeMsg.created_at)}</span>
                      </div>
                    </div>

                    {/* Message body */}
                    <div className="text-[12px] leading-[1.7]" style={{
                      color: activeMsg.role === 'decision' ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.65)',
                    }}>
                      {activeMsg.message}
                    </div>

                    {/* Decision data */}
                    {activeMsg.role === 'decision' && activeMsg.data && (
                      <div className="mt-4 pt-3 flex items-center gap-4" style={{ borderTop: '1px solid rgba(255,204,0,.1)' }}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-bold" style={{ color: '#00ffa3' }}>{String(activeMsg.data.votesFor ?? liveVotes.f)}</span>
                          <span className="text-[8px] font-bold" style={{ color: 'rgba(255,255,255,.25)' }}>ZA</span>
                        </div>
                        <div style={{ width: 60, height: 5, borderRadius: 3, background: 'rgba(255,51,102,.2)', overflow: 'hidden' }}>
                          <div style={{
                            width: `${(() => {
                              const vf = Number(activeMsg.data.votesFor ?? liveVotes.f)
                              const va = Number(activeMsg.data.votesAgainst ?? liveVotes.a)
                              return vf + va > 0 ? (vf / (vf + va)) * 100 : 50
                            })()}%`,
                            height: '100%', background: '#00ffa3', borderRadius: 3,
                          }} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-bold" style={{ color: '#ff3366' }}>{String(activeMsg.data.votesAgainst ?? liveVotes.a)}</span>
                          <span className="text-[8px] font-bold" style={{ color: 'rgba(255,255,255,.25)' }}>PROTIV</span>
                        </div>
                        <span className="text-[9px] font-bold px-3 py-1 rounded-full ml-2" style={{
                          background: activeMsg.data.execute ? 'rgba(0,255,163,.12)' : 'rgba(255,51,102,.12)',
                          color: activeMsg.data.execute ? '#00ffa3' : '#ff3366',
                          border: `1px solid ${activeMsg.data.execute ? 'rgba(0,255,163,.25)' : 'rgba(255,51,102,.25)'}`,
                        }}>
                          {activeMsg.data.execute ? '✓ ODOBRENO' : '✕ ODBIJENO'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {/* BOTTOM ROW — agents */}
            <div className="flex justify-center gap-1 flex-shrink-0">
              {BOT_ROW.map(id => (
                <Seat key={id} id={id} active={id === activeAgentId} stance={stances[id]} isChair={id === 'orchestrator'}
                  onClick={() => { const i = speaks.findIndex(m => m.agent === id); if (i >= 0) { setStep(i); setPlaying(false) } }} />
              ))}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 px-2 py-1 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,.04)' }}>
              <button onClick={() => setStep(0)} className="text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.3)' }}>⏮</button>
              <button onClick={() => setStep(s => Math.max(0, s - 1))} className="text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.3)' }}>◀</button>

              <div className="flex-1 h-1.5 rounded-full cursor-pointer" style={{ background: 'rgba(255,255,255,.04)' }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setStep(Math.round(((e.clientX - r.left) / r.width) * Math.max(speaks.length - 1, 0)))
                }}>
                <div style={{
                  width: speaks.length > 0 ? `${((step + 1) / speaks.length) * 100}%` : '0%',
                  height: '100%', borderRadius: 4, transition: 'width .3s',
                  background: AGENTS[activeAgentId ?? '']?.color ?? '#ffcc00',
                }} />
              </div>

              <button onClick={() => setStep(s => Math.min(speaks.length - 1, s + 1))} className="text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.3)' }}>▶</button>
              <button onClick={() => setStep(speaks.length - 1)} className="text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.3)' }}>⏭</button>

              <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,.06)' }} />

              <span className="text-[8px] font-mono min-w-[40px] text-center" style={{ color: 'rgba(255,255,255,.2)' }}>
                {speaks.length > 0 ? `${step + 1}/${speaks.length}` : '—'}
              </span>

              <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,.06)' }} />

              <button onClick={() => setPlaying(p => !p)} className="text-[9px] font-bold px-3 py-1 rounded-full" style={{
                background: playing ? 'rgba(255,51,102,.1)' : 'rgba(0,255,163,.1)',
                color: playing ? '#ff3366' : '#00ffa3',
                border: `1px solid ${playing ? 'rgba(255,51,102,.2)' : 'rgba(0,255,163,.2)'}`,
              }}>
                {playing ? '⏸ PAUZA' : '▶ PLAY'}
              </button>

              <span className="text-[7px] ml-auto hidden md:inline" style={{ color: 'rgba(255,255,255,.12)' }}>← → Space</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Agent Seat ── */

function Seat({ id, active, stance, isChair, onClick }: {
  id: string; active: boolean; stance?: 'bull' | 'bear' | 'neutral'; isChair?: boolean; onClick: () => void
}) {
  const a = AGENTS[id]
  if (!a) return null
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 rounded-lg transition-all relative" style={{
      padding: '6px 10px',
      minWidth: 68,
      background: active ? 'rgba(255,255,255,.04)' : 'transparent',
      borderBottom: active ? `2px solid ${a.color}` : '2px solid transparent',
      borderTop: active ? `2px solid ${a.color}` : '2px solid transparent',
    }}>
      {/* Glow ring when active */}
      {active && (
        <div className="absolute inset-0 rounded-lg glow" style={{ '--pc': `${a.color}30` } as React.CSSProperties} />
      )}
      <span style={{ fontSize: isChair ? 26 : 22, position: 'relative' }}>{a.icon}</span>
      <span className="text-[8px] font-bold relative" style={{
        color: active ? a.color : 'rgba(255,255,255,.3)',
        textShadow: active ? `0 0 8px ${a.color}` : 'none',
      }}>
        {a.name}
      </span>
      {isChair && <span className="text-[5px] tracking-[.15em] font-bold relative" style={{ color: 'rgba(255,204,0,.3)' }}>CHAIRMAN</span>}
      {stance && stance !== 'neutral' && (
        <span className="text-[7px] font-bold relative" style={{ color: stance === 'bull' ? '#00ffa3' : '#ff3366' }}>
          {stance === 'bull' ? '▲' : '▼'}
        </span>
      )}
    </button>
  )
}
