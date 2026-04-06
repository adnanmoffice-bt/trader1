'use client'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { RealtimeProvider } from '@/components/providers/RealtimeProvider'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

const AGENTS: Record<string, { icon: string; name: string; desc: string }> = {
  'orchestrator':       { icon: '🧠', name: 'Orchestrator',       desc: 'Coordinates all agents, runs the trading pipeline' },
  'market-analyst':     { icon: '📰', name: 'Market Analyst',     desc: 'Analyzes news and market sentiment using AI' },
  'risk-manager':       { icon: '🛡', name: 'Risk Manager',       desc: 'Validates R:R, position sizing, exposure limits' },
  'polymarket-scanner': { icon: '🔮', name: 'Polymarket Scanner', desc: 'Scans prediction markets for mispriced events' },
  'trade-reviewer':     { icon: '📊', name: 'Trade Reviewer',     desc: 'Daily review of closed trades and performance' },
  'kill-switch':        { icon: '🚨', name: 'Kill Switch',        desc: 'Emergency halt system' },
}

const LEVEL_STYLE: Record<string, { dot: string; bg: string; label: string }> = {
  ok:    { dot: 'bg-[var(--green)]',  bg: 'border-l-[var(--green)]',  label: 'SUCCESS' },
  warn:  { dot: 'bg-[var(--amber)]',  bg: 'border-l-[var(--amber)]',  label: 'WARNING' },
  error: { dot: 'bg-[var(--red)]',    bg: 'border-l-[var(--red)]',    label: 'ERROR' },
  info:  { dot: 'bg-[var(--blue)]',   bg: 'border-l-[var(--blue)]',   label: 'INFO' },
}

function AILogInner() {
  const agentLogs = useStore(s => s.agentLogs)
  const [filterAgent, setFilterAgent] = useState('all')

  useEffect(() => {
    const st = useStore.getState()
    fetch('/api/agent-logs').then(r => r.json()).then(d => {
      if (d.data) d.data.forEach((log: any) => st.addAgentLog(log))
    }).catch(() => {})
  }, [])

  const logs = filterAgent === 'all' ? agentLogs : agentLogs.filter(l => l.agent === filterAgent)

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-black text-[var(--text-primary)]">AI Activity Log</h1>
        <div className="flex items-center gap-1 flex-wrap">
          {['all', ...Object.keys(AGENTS)].map(a => (
            <button key={a} onClick={() => setFilterAgent(a)} className={cn(
              'px-2.5 py-1 text-[10px] font-semibold rounded-md transition-colors',
              filterAgent === a ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
            )}>{a === 'all' ? 'All' : AGENTS[a]?.icon + ' ' + (AGENTS[a]?.name ?? a)}</button>
          ))}
        </div>
      </div>

      {/* Agent status cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {Object.entries(AGENTS).filter(([k]) => k !== 'kill-switch').map(([id, meta]) => {
          const last = agentLogs.find(l => l.agent === id)
          const isActive = last && (Date.now() - new Date(last.created_at).getTime()) < 3600_000
          const time = last ? new Date(last.created_at).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '—'
          return (
            <div key={id} className="rounded-xl border border-[var(--border)] p-3" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{meta.icon}</span>
                <span className="text-[11px] font-bold text-[var(--text-primary)]">{meta.name}</span>
                <span className={cn('w-2 h-2 rounded-full ml-auto', isActive ? 'bg-[var(--green)] animate-pulse' : 'bg-[var(--text-muted)]')} />
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mb-1">{meta.desc}</div>
              <div className="text-[9px] mono text-[var(--text-secondary)]">Last: {time}</div>
            </div>
          )
        })}
      </div>

      {/* Log entries */}
      <div className="space-y-2">
        {logs.slice(0, 50).map((log, i) => {
          const agent = AGENTS[log.agent] ?? { icon: '⚡', name: log.agent, desc: '' }
          const style = LEVEL_STYLE[log.level] ?? LEVEL_STYLE.info
          const time = new Date(log.created_at).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })
          const date = new Date(log.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })
          return (
            <div key={i} className={cn('rounded-lg border border-[var(--border)] border-l-4 p-3 hover:shadow-sm transition-shadow', style.bg)} style={{ background: 'var(--bg-panel)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className={cn('w-2 h-2 rounded-full', style.dot)} />
                <span className="text-[10px] mono text-[var(--text-muted)]">{date} {time}</span>
                <span className="text-sm">{agent.icon}</span>
                <span className="text-[11px] font-bold text-[var(--purple)]">{agent.name}</span>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{style.label}</span>
              </div>
              <div className="text-[12px] text-[var(--text-primary)] leading-relaxed pl-4">{log.message}</div>
            </div>
          )
        })}
        {logs.length === 0 && <div className="text-center py-16 text-[var(--text-muted)]">No agent activity yet. Cron runs every 30 minutes.</div>}
      </div>
    </div>
  )
}

export default function AILogPage() {
  return <RealtimeProvider><AILogInner /></RealtimeProvider>
}
