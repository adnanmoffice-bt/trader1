'use client'
import { useEffect, useState } from 'react'

const AGENTS: Record<string, { icon: string; name: string; color: string }> = {
  'orchestrator':       { icon: '🧠', name: 'Orchestrator',    color: 'var(--amber)' },
  'macro-agent':        { icon: '🌍', name: 'Macro',           color: 'var(--cyan)' },
  'correlation-agent':  { icon: '🔗', name: 'Correlation',     color: 'var(--blue)' },
  'bull-agent':         { icon: '🐂', name: 'Bull',            color: 'var(--green)' },
  'bear-agent':         { icon: '🐻', name: 'Bear',            color: 'var(--red)' },
  'scalper-agent':      { icon: '⚡', name: 'Scalper',         color: 'var(--cyan)' },
  'trend-agent':        { icon: '📈', name: 'Trend',           color: 'var(--blue)' },
  'market-analyst':     { icon: '📰', name: 'Analyst',         color: 'var(--purple)' },
  'signal-generator':   { icon: '🎯', name: 'Signal',          color: 'var(--green)' },
  'risk-manager':       { icon: '🛡', name: 'Risk',            color: 'var(--red)' },
  'trade-reviewer':     { icon: '📊', name: 'Reviewer',        color: 'var(--amber)' },
  'master-agent':       { icon: '👑', name: 'Master',          color: 'var(--amber)' },
}

const ROLE_BADGE: Record<string, { bg: string; label: string }> = {
  open:     { bg: 'var(--bg-2)', label: 'OPEN' },
  speak:    { bg: 'var(--bg-2)', label: 'SPEAK' },
  question: { bg: 'var(--blue)', label: 'ASK' },
  decision: { bg: 'var(--amber)', label: 'DECISION' },
  alert:    { bg: 'var(--red)', label: 'ALERT' },
  close:    { bg: 'var(--bg-3)', label: 'CLOSE' },
}

interface Msg { id: string; meeting_id: string; agent: string; role: string; message: string; instrument: string; created_at: string; data?: any }
interface Meeting { id: string; instrument: string; messageCount: number; startedAt: string; decision: string; messages: Msg[] }

export default function WarRoomPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null)
  const [displayMsgs, setDisplayMsgs] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  useEffect(() => {
    fetch('/api/war-room?limit=50').then(r => r.json()).then(d => {
      setMeetings(d.meetings ?? [])
      if (d.meetings?.length) {
        setSelectedMeeting(d.meetings[0].id)
        loadMeetingMessages(d.meetings[0].id)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function loadMeetingMessages(meetingId: string) {
    setLoadingMsgs(true)
    setSelectedMeeting(meetingId)
    fetch(`/api/war-room?meeting=${meetingId}`).then(r => r.json()).then(d => {
      setDisplayMsgs(d.data ?? [])
      setLoadingMsgs(false)
    }).catch(() => setLoadingMsgs(false))
  }

  return (
    <div className="h-full flex">
      {/* LEFT: Meeting List */}
      <div className="w-56 flex-shrink-0 overflow-y-auto" style={{ background: 'var(--bg-1)', borderRight: '1px solid var(--border)' }}>
        <div className="px-2 py-2">
          <div className="text-[9px] font-bold tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>WAR ROOM MEETINGS</div>
          {meetings.length === 0 && !loading && (
            <div className="text-[10px] p-2" style={{ color: 'var(--text-3)' }}>No meetings yet. Run the signals cron to start a War Room session.</div>
          )}
          {loading && <div className="text-[10px] p-2" style={{ color: 'var(--text-3)' }}>Loading...</div>}
          {meetings.map(m => (
            <button key={m.id} onClick={() => loadMeetingMessages(m.id)} className="w-full text-left px-2 py-2 rounded mb-0.5 transition-colors" style={{
              background: selectedMeeting === m.id ? 'var(--bg-2)' : 'transparent',
              borderLeft: selectedMeeting === m.id ? '2px solid var(--amber)' : '2px solid transparent',
            }}>
              <div className="flex justify-between">
                <span className="text-[11px] font-bold" style={{ color: 'var(--text-0)' }}>{m.instrument}</span>
                <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{m.messageCount} msgs</span>
              </div>
              <div className="text-[9px]" style={{ color: 'var(--text-2)' }}>{m.startedAt ? new Date(m.startedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + new Date(m.startedAt).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
              <div className="text-[9px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{m.decision}</div>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: Conversation */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-0)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 flex-shrink-0" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>WAR ROOM</span>
            {selectedMeeting && <span className="text-[10px] font-bold" style={{ color: 'var(--text-0)' }}>{meetings.find(m => m.id === selectedMeeting)?.instrument}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(AGENTS).map(([id, a]) => (
              <span key={id} className="flex items-center gap-0.5 text-[8px]" style={{ color: a.color }}>
                <span>{a.icon}</span><span className="font-bold">{a.name}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {loadingMsgs && (
            <div className="flex items-center justify-center h-full">
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>Loading debate...</div>
            </div>
          )}
          {!loadingMsgs && displayMsgs.length === 0 && (
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
            const agent = AGENTS[msg.agent] ?? { icon: '⚡', name: msg.agent, color: 'var(--text-2)' }
            const role = ROLE_BADGE[msg.role] ?? ROLE_BADGE.speak
            const time = new Date(msg.created_at).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })
            const isDecision = msg.role === 'decision'
            const isOpen = msg.role === 'open'
            const isClose = msg.role === 'close'

            if (isOpen) {
              return (
                <div key={i} className="text-center py-2">
                  <span className="text-[10px] px-3 py-1 rounded-full" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                    {agent.icon} {msg.message}
                  </span>
                </div>
              )
            }

            if (isClose) {
              return (
                <div key={i} className="text-center py-2">
                  <span className="text-[10px] px-3 py-1 rounded-full" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                    {msg.message}
                  </span>
                </div>
              )
            }

            return (
              <div key={i} className="flex gap-2 py-1.5 rounded px-2 transition-colors" style={{
                background: isDecision ? 'var(--bg-2)' : 'transparent',
                borderLeft: isDecision ? `3px solid var(--amber)` : `3px solid transparent`,
              }}>
                <div className="flex-shrink-0 w-7 text-center text-lg pt-0.5">{agent.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.name}</span>
                    <span className="text-[7px] font-bold px-1.5 py-0.5 rounded" style={{ background: role.bg, color: isDecision ? '#000' : 'var(--text-2)' }}>{role.label}</span>
                    <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{time}</span>
                  </div>
                  <div className="text-[11px] leading-relaxed" style={{ color: isDecision ? 'var(--text-0)' : 'var(--text-1)' }}>
                    {msg.message}
                  </div>
                  {isDecision && msg.data && (
                    <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                      <span className="font-bold" style={{ color: 'var(--green)' }}>FOR: {String((msg.data as any)?.votesFor ?? '?')}</span>
                      <span className="font-bold" style={{ color: 'var(--red)' }}>AGAINST: {String((msg.data as any)?.votesAgainst ?? '?')}</span>
                      <span style={{ color: 'var(--text-3)' }}>| {String((msg.data as any)?.agentCount ?? 12)} agents</span>
                      <span className="font-bold" style={{ color: (msg.data as any)?.execute ? 'var(--green)' : 'var(--red)' }}>
                        {(msg.data as any)?.execute ? 'TRADE EXECUTED' : 'TRADE REJECTED'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
