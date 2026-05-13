'use client'
/**
 * /live-trades — operator view for external-signal real-money trades.
 *
 * Three panels:
 *   1. Open IG positions (real money, not demo)
 *   2. Recent external signals (with execution status colour-coded)
 *   3. Webhook activity log (every Signal Feed forward we receive)
 *
 * Plus a header bar showing the live env state (executor_enabled, dry_run,
 * require_forward, instruments) so the operator can spot a misconfig at
 * a glance.
 *
 * Auto-refresh: every 5 seconds. Manual refresh button also present.
 */
import { useEffect, useState, useCallback } from 'react'

interface OpenPosition {
  id: string
  instrument: string
  direction: 'long' | 'short'
  quantity: number
  entry_price: number
  stop_loss: number | null
  take_profit: number | null
  opened_at: string
  status: string
  notes: string | null
}

interface ExternalSignal {
  id: string
  created_at: string
  message_date: string | null
  source: string
  instrument: string | null
  direction: 'long' | 'short' | null
  entry_price: number | null
  stop_loss: number | null
  take_profit: number | null
  execution_status: 'pending' | 'executing' | 'executed' | 'skipped' | 'failed' | 'disabled'
  skip_reason: string | null
  exec_error: string | null
  executed_trade_id: string | null
  parse_status: 'pending' | 'parsed' | 'unparseable'
  parser_version: string | null
  metadata: Record<string, unknown> | null
}

interface AgentLog {
  id: string
  created_at: string
  agent: string
  level: 'info' | 'ok' | 'warn' | 'error'
  message: string
  metadata: Record<string, unknown> | null
}

interface LiveTradesData {
  ok: boolean
  server_time: string
  open_positions: OpenPosition[]
  recent_signals: ExternalSignal[]
  webhook_activity: AgentLog[]
  state: {
    executor_enabled: boolean
    dry_run: boolean
    require_forward: boolean
    instruments: string[]
    forward_from: string[]
    max_age_min: number
  }
  errors: Record<string, string | null>
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${Math.floor(sec)}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function StatusBadge({ status }: { status: ExternalSignal['execution_status'] }) {
  const colours: Record<string, string> = {
    pending: 'var(--amber)',
    executing: 'var(--amber)',
    executed: 'var(--green)',
    skipped: 'var(--text-3)',
    failed: 'var(--red)',
    disabled: 'var(--text-3)',
  }
  return (
    <span
      className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm whitespace-nowrap"
      style={{ background: 'var(--bg-2)', color: colours[status] || 'var(--text-2)' }}>
      {status.toUpperCase()}
    </span>
  )
}

export default function LiveTradesPage() {
  const [data, setData] = useState<LiveTradesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [tick, setTick] = useState(0)

  const fetchData = useCallback(() => {
    fetch('/api/live-trades')
      .then(r => r.json())
      .then((d: LiveTradesData) => {
        if (!d.ok) throw new Error('endpoint returned ok=false')
        setData(d)
        setErr(null)
      })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => { fetchData(); setTick(x => x + 1) }, 5000)
    return () => clearInterval(t)
  }, [autoRefresh, fetchData])

  // ── State banner ─────────────────────────────────────────────────────────
  const state = data?.state
  const allGreen = !!state && state.executor_enabled && !state.dry_run && state.require_forward
  const armedBut = !!state && state.executor_enabled && !state.dry_run
  const bannerColor = allGreen ? 'var(--green)' : armedBut ? 'var(--amber)' : 'var(--text-3)'
  const bannerText = !state ? 'LOADING…'
                   : allGreen ? 'FULLY ARMED — real money active, all safety filters on'
                   : armedBut ? 'ARMED — real money active, but a safety filter is OFF (see state below)'
                   : state.executor_enabled && state.dry_run ? 'DRY RUN — signals parsed and logged, NO real orders'
                   : 'DISABLED — executor off, no orders will fire'

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>LIVE TRADES — EXTERNAL SIGNALS</span>
        <span className="ml-3 text-[9px] font-bold" style={{ color: bannerColor }}>
          ● {bannerText}
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[9px] mr-3" style={{ color: 'var(--text-3)' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="scale-75" />
          AUTO 5s {autoRefresh && <span style={{ color: 'var(--green)' }}>●{tick % 2 ? ' ' : ' '}</span>}
        </label>
        <button onClick={fetchData} className="text-[9px] font-bold px-2 py-0.5 rounded-sm"
          style={{ background: 'var(--bg-2)', color: 'var(--amber)' }}>REFRESH</button>
      </div>

      {err && (
        <div className="px-3 py-1 text-[10px]" style={{ background: '#3a1a1a', color: 'var(--red)' }}>
          fetch error: {err}
        </div>
      )}

      {loading && !data && (
        <div className="flex-1 flex items-center justify-center text-[10px]" style={{ color: 'var(--text-3)' }}>
          Loading live trades…
        </div>
      )}

      {data && (
        <div className="flex-1 overflow-auto p-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
          {/* Open positions */}
          <section className="lg:col-span-2 rounded-sm" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center px-2 py-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
              <span className="text-[10px] font-bold" style={{ color: 'var(--amber)' }}>OPEN POSITIONS — REAL MONEY ({data.open_positions.length})</span>
              <span className="ml-2 text-[9px]" style={{ color: 'var(--text-3)' }}>is_demo = false · status = open</span>
            </div>
            {data.open_positions.length === 0 ? (
              <div className="p-4 text-center text-[10px]" style={{ color: 'var(--text-3)' }}>
                No open real-money positions. (Awaiting first Signal Feed forward.)
              </div>
            ) : (
              <table className="w-full text-[10px]">
                <thead style={{ background: 'var(--bg-2)' }}>
                  <tr style={{ color: 'var(--text-3)' }}>
                    <th className="text-left px-2 py-1 font-semibold">OPENED</th>
                    <th className="text-left px-2 py-1 font-semibold">INSTR</th>
                    <th className="text-left px-2 py-1 font-semibold">DIR</th>
                    <th className="text-right px-2 py-1 font-semibold">SIZE</th>
                    <th className="text-right px-2 py-1 font-semibold">ENTRY</th>
                    <th className="text-right px-2 py-1 font-semibold">SL</th>
                    <th className="text-right px-2 py-1 font-semibold">TP</th>
                    <th className="text-left px-2 py-1 font-semibold">IG DEAL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.open_positions.map(p => {
                    let igDealId: string | null = null
                    try { igDealId = p.notes ? (JSON.parse(p.notes).ig_deal_id ?? null) : null } catch {}
                    return (
                      <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-2 py-1" style={{ color: 'var(--text-2)' }}>{timeAgo(p.opened_at)}</td>
                        <td className="px-2 py-1 font-bold" style={{ color: 'var(--amber)' }}>{p.instrument}</td>
                        <td className="px-2 py-1 font-bold" style={{ color: p.direction === 'long' ? 'var(--green)' : 'var(--red)' }}>
                          {p.direction.toUpperCase()}
                        </td>
                        <td className="text-right px-2 py-1">{fmtNum(p.quantity, 2)}</td>
                        <td className="text-right px-2 py-1">{fmtNum(p.entry_price, 2)}</td>
                        <td className="text-right px-2 py-1" style={{ color: 'var(--red)' }}>{fmtNum(p.stop_loss, 2)}</td>
                        <td className="text-right px-2 py-1" style={{ color: 'var(--green)' }}>{fmtNum(p.take_profit, 2)}</td>
                        <td className="px-2 py-1 text-[9px]" style={{ color: 'var(--text-3)' }}>{igDealId ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* Recent external signals */}
          <section className="rounded-sm" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center px-2 py-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
              <span className="text-[10px] font-bold" style={{ color: 'var(--amber)' }}>RECENT SIGNALS ({data.recent_signals.length})</span>
              <span className="ml-2 text-[9px]" style={{ color: 'var(--text-3)' }}>from external_signals</span>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-[10px]">
                <thead style={{ background: 'var(--bg-2)', position: 'sticky', top: 0 }}>
                  <tr style={{ color: 'var(--text-3)' }}>
                    <th className="text-left px-2 py-1 font-semibold">AGE</th>
                    <th className="text-left px-2 py-1 font-semibold">INSTR</th>
                    <th className="text-left px-2 py-1 font-semibold">DIR</th>
                    <th className="text-right px-2 py-1 font-semibold">ENT</th>
                    <th className="text-right px-2 py-1 font-semibold">SL</th>
                    <th className="text-right px-2 py-1 font-semibold">TP</th>
                    <th className="text-left px-2 py-1 font-semibold">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_signals.length === 0 && (
                    <tr><td colSpan={7} className="px-2 py-3 text-center text-[10px]" style={{ color: 'var(--text-3)' }}>No signals received yet.</td></tr>
                  )}
                  {data.recent_signals.map(s => (
                    <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}
                        title={s.skip_reason ?? s.exec_error ?? ''}>
                      <td className="px-2 py-1" style={{ color: 'var(--text-2)' }}>{timeAgo(s.created_at)}</td>
                      <td className="px-2 py-1 font-bold" style={{ color: 'var(--amber)' }}>{s.instrument ?? '—'}</td>
                      <td className="px-2 py-1 font-bold" style={{ color: s.direction === 'long' ? 'var(--green)' : s.direction === 'short' ? 'var(--red)' : 'var(--text-3)' }}>
                        {s.direction?.toUpperCase() ?? '—'}
                      </td>
                      <td className="text-right px-2 py-1">{fmtNum(s.entry_price, 2)}</td>
                      <td className="text-right px-2 py-1">{fmtNum(s.stop_loss, 2)}</td>
                      <td className="text-right px-2 py-1">{fmtNum(s.take_profit, 2)}</td>
                      <td className="px-2 py-1"><StatusBadge status={s.execution_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Webhook activity */}
          <section className="rounded-sm" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center px-2 py-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
              <span className="text-[10px] font-bold" style={{ color: 'var(--amber)' }}>WEBHOOK ACTIVITY ({data.webhook_activity.length})</span>
              <span className="ml-2 text-[9px]" style={{ color: 'var(--text-3)' }}>last 30 from agent_logs</span>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              {data.webhook_activity.length === 0 ? (
                <div className="p-4 text-center text-[10px]" style={{ color: 'var(--text-3)' }}>No webhook activity yet.</div>
              ) : (
                <ul>
                  {data.webhook_activity.map(l => {
                    const dur = l.metadata ? (l.metadata.duration_ms as number | undefined) : undefined
                    const levelColor = l.level === 'error' ? 'var(--red)'
                                     : l.level === 'warn' ? 'var(--amber)'
                                     : l.level === 'ok' ? 'var(--green)'
                                     : 'var(--text-2)'
                    return (
                      <li key={l.id} className="px-2 py-1 text-[10px]" style={{ borderTop: '1px solid var(--border)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] w-12" style={{ color: 'var(--text-3)' }}>{timeAgo(l.created_at)}</span>
                          <span className="text-[9px] font-bold w-3" style={{ color: levelColor }}>●</span>
                          <span className="text-[9px] font-mono w-32 truncate" style={{ color: 'var(--text-3)' }}>{l.agent}</span>
                          {dur != null && <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{dur}ms</span>}
                        </div>
                        <div className="ml-16 mt-0.5" style={{ color: 'var(--text-2)' }}>{l.message}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Live state box */}
          <section className="lg:col-span-2 rounded-sm" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center px-2 py-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
              <span className="text-[10px] font-bold" style={{ color: 'var(--amber)' }}>LIVE STATE</span>
              <span className="ml-2 text-[9px]" style={{ color: 'var(--text-3)' }}>read from Vercel env on every request</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 p-2 text-[10px]">
              <Stat label="EXECUTOR" value={state?.executor_enabled ? 'ENABLED' : 'DISABLED'} ok={state?.executor_enabled} />
              <Stat label="DRY RUN" value={state?.dry_run ? 'YES' : 'NO'} ok={state ? !state.dry_run : null} />
              <Stat label="REQUIRE FORWARD" value={state?.require_forward ? 'YES' : 'NO'} ok={state?.require_forward} />
              <Stat label="MAX AGE" value={state?.max_age_min ? `${state.max_age_min} min` : '—'} ok={null} />
              <Stat label="INSTRUMENTS" value={state?.instruments?.join(', ') || '—'} ok={null} />
              <Stat label="FORWARD FROM" value={state?.forward_from?.join(', ') || '—'} ok={null} />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean | null | undefined }) {
  const colour = ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--text-2)'
  return (
    <div className="rounded-sm px-2 py-1" style={{ background: 'var(--bg-2)' }}>
      <div className="text-[8px] font-bold" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-[10px] font-bold" style={{ color: colour }}>{value}</div>
    </div>
  )
}
