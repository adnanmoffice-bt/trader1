'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

function Gauge({ label, value, max, unit, danger }: { label: string; value: number; max: number; unit: string; danger: boolean }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = danger ? 'var(--red)' : pct > 70 ? 'var(--amber)' : 'var(--green)'
  return (
    <div className="rounded-xl border border-[var(--border)] p-4" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-wider uppercase">{label}</span>
        <span className="text-[10px] font-bold" style={{ color }}>{value.toFixed(1)}{unit} / {max}{unit}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function InvestorPage() {
  const { theme, toggle } = useTheme()
  const router = useRouter()
  const [user, setUser] = useState<{ name: string; email: string } | null>(null)
  const [safety, setSafety] = useState<Record<string, unknown> | null>(null)
  const [signals, setSignals] = useState<Array<Record<string, unknown>>>([])
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([])
  const [demoData, setDemoData] = useState<{ session: Record<string, unknown> | null; trades: Array<Record<string, unknown>> }>({ session: null, trades: [] })
  const [prices, setPrices] = useState<Record<string, Record<string, unknown>>>({})
  const [killLoading, setKillLoading] = useState(false)
  const [clock, setClock] = useState('')

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user); else router.push('/login') }).catch(() => router.push('/login'))
    fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
    fetch('/api/signals?limit=10').then(r => r.json()).then(d => { if (d.data) setSignals(d.data) }).catch(() => {})
    fetch('/api/agent-logs').then(r => r.json()).then(d => { if (d.data) setLogs(d.data) }).catch(() => {})
    fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    fetch('/api/prices').then(r => r.json()).then(d => {
      if (d.data) { const m: Record<string, Record<string, unknown>> = {}; d.data.forEach((p: Record<string, unknown>) => { m[String(p.symbol)] = p }); setPrices(m) }
    }).catch(() => {})
    const t = setInterval(() => {
      fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
      fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    }, 30000)
    return () => clearInterval(t)
  }, [router])

  async function handleLogout() { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login'); router.refresh() }
  async function handleKill() {
    if (!confirm('KILL SWITCH: Stop ALL trading for 24h?')) return
    setKillLoading(true)
    await fetch('/api/kill-switch', { method: 'POST', body: JSON.stringify({}) })
    setSafety(s => s ? { ...s, safe: false, killSwitchActive: true, reason: 'Kill switch active' } : s)
    setKillLoading(false)
  }

  const s = demoData.session
  const openTrades = demoData.trades.filter(t => !t.exit_time)
  const closedTrades = demoData.trades.filter(t => t.exit_time)
  const demoPnl = Number(s?.total_pnl || 0)
  const demoCapital = Number(s?.initial_capital || 5000)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="flex items-center justify-between px-6 h-14 border-b border-[var(--border)]" style={{ background: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-4">
          <span className="text-lg font-black text-[var(--text-primary)]">APEX</span>
          <span className="flex items-center gap-1.5 text-[9px] font-bold text-[var(--green)] tracking-[0.15em] px-2 py-1 rounded border" style={{ borderColor: 'var(--green)', background: 'var(--green)', color: 'white' }}>LIVE</span>
          <a href="/" className="text-[10px] text-[var(--text-muted)] hover:text-[var(--blue)]">Terminal</a>
          <a href="/settings" className="text-[10px] text-[var(--text-muted)] hover:text-[var(--blue)]">Settings</a>
        </div>
        <div className="flex items-center gap-5 text-[11px]">
          <span className="mono font-bold text-[var(--blue)]">{clock}</span>
          <span className="text-[var(--text-secondary)]">{user?.name}</span>
          <button onClick={toggle} className="text-[9px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">{theme === 'light' ? '🌙' : '☀️'}</button>
          <button onClick={handleLogout} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--red)]">Logout</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Portfolio */}
        <section>
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Portfolio Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { l: 'CAPITAL', v: `$${demoCapital.toLocaleString()}` },
              { l: 'CURRENT', v: `$${Number(s?.final_capital || demoCapital).toLocaleString()}`, cls: demoPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'TOTAL P&L', v: `${demoPnl >= 0 ? '+' : ''}$${Math.abs(demoPnl).toLocaleString()}`, cls: demoPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'WIN RATE', v: `${(Number(s?.win_count || 0) + Number(s?.loss_count || 0)) > 0 ? (Number(s?.win_count || 0) / (Number(s?.win_count || 0) + Number(s?.loss_count || 0)) * 100).toFixed(0) : '—'}%` },
              { l: 'TOTAL TRADES', v: `${s?.total_trades ?? 0}` },
              { l: 'OPEN', v: `${openTrades.length} positions`, cls: 'text-[var(--blue)]' },
            ].map(st => (
              <div key={st.l} className="rounded-xl border border-[var(--border)] p-4" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
                <div className="text-[9px] text-[var(--text-muted)] tracking-wider mb-2">{st.l}</div>
                <div className={cn('text-lg font-black mono', st.cls || 'text-[var(--text-primary)]')}>{st.v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Safety */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Safety System</h2>
            <div className="flex items-center gap-3">
              <span className={cn('flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded border',
                safety?.safe ? 'border-[var(--green)] text-[var(--green)] bg-green-50' : 'border-[var(--red)] text-[var(--red)] bg-red-50'
              )}>
                <span className={cn('w-2 h-2 rounded-full', safety?.safe ? 'bg-[var(--green)]' : 'bg-[var(--red)] animate-pulse')} />
                {safety?.safe ? 'ALL OK' : String(safety?.reason ?? 'ISSUE')}
              </span>
              <button onClick={handleKill} disabled={killLoading}
                className="px-3 py-1.5 text-[9px] font-black tracking-wider bg-red-50 text-[var(--red)] border border-red-200 rounded hover:bg-red-100 transition-all disabled:opacity-50">
                {killLoading ? '...' : 'KILL SWITCH'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Gauge label="Drawdown" value={(Number(safety?.drawdownPct ?? 0)) * 100} max={15} unit="%" danger={!safety?.drawdownOk} />
            <Gauge label="Daily Loss" value={(Number(safety?.dailyLossPct ?? 0)) * 100} max={3} unit="%" danger={!safety?.dailyLossOk} />
            <Gauge label="Open Positions" value={Number(safety?.openPositions ?? 0)} max={3} unit="" danger={!safety?.positionsOk} />
          </div>
        </section>

        {/* Open Positions */}
        <section>
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Active Positions ({openTrades.length})</h2>
          {openTrades.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] p-6 text-center text-[var(--text-muted)] text-sm" style={{ background: 'var(--bg-panel)' }}>No open positions — bot waiting for signal</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {openTrades.map((t, i) => {
                const dir = String(t.direction), entry = Number(t.entry_price), cur = Number(t.current_price || entry)
                const livePnl = Number(t.live_pnl_aed || 0), livePct = Number(t.live_pnl_pct || 0), isUp = livePnl >= 0
                return (
                  <div key={i} className={cn('rounded-xl border border-[var(--border)] overflow-hidden', dir === 'long' ? 'border-l-4 border-l-[var(--green)]' : 'border-l-4 border-l-[var(--red)]')} style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
                    <div className="flex items-center justify-between p-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-[var(--text-primary)]">{String(t.instrument)}</span>
                          <span className={cn('text-[9px] font-black px-2 py-0.5 rounded', dir === 'long' ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]')}>{dir.toUpperCase()}</span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">{String(t.signal_reason)}</div>
                      </div>
                      <div className="text-right">
                        <div className={cn('text-lg font-black mono', isUp ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{isUp ? '+' : ''}${livePnl.toFixed(0)}</div>
                        <div className={cn('text-[11px] mono', isUp ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{isUp ? '+' : ''}{livePct.toFixed(2)}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-px" style={{ background: 'var(--border)' }}>
                      {[
                        { l: 'ENTRY', v: `$${entry >= 1000 ? entry.toLocaleString('en', { maximumFractionDigits: 0 }) : entry.toFixed(2)}` },
                        { l: 'CURRENT', v: `$${cur >= 1000 ? cur.toLocaleString('en', { maximumFractionDigits: 0 }) : cur.toFixed(2)}` },
                        { l: 'STOP LOSS', v: `$${Number(t.stop_loss).toFixed(2)}` },
                        { l: 'TARGET', v: `$${Number(t.take_profit).toFixed(2)}` },
                      ].map(c => (
                        <div key={c.l} className="p-2.5 text-center" style={{ background: 'var(--bg-secondary)' }}>
                          <div className="text-[8px] text-[var(--text-muted)] mb-0.5">{c.l}</div>
                          <div className="text-[11px] font-bold mono text-[var(--text-primary)]">{c.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* AI Decisions + How It Works side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* AI Decision Log */}
          <section>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">AI Decision Log</h2>
            <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              {logs.slice(0, 15).map((log, i) => {
                const level = String(log.level ?? 'info')
                const dotCls = level === 'ok' ? 'bg-[var(--green)]' : level === 'warn' ? 'bg-[var(--amber)]' : level === 'error' ? 'bg-[var(--red)]' : 'bg-[var(--text-muted)]'
                const time = log.created_at ? new Date(String(log.created_at)).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : ''
                return (
                  <div key={i} className="flex items-start gap-2.5 px-4 py-2 border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)]">
                    <div className={cn('w-2 h-2 rounded-full mt-1 flex-shrink-0', dotCls)} />
                    <span className="text-[10px] text-[var(--text-muted)] mono w-12 flex-shrink-0">{time}</span>
                    <span className="text-[10px] font-bold text-[var(--purple)] w-20 flex-shrink-0">{String(log.agent)}</span>
                    <span className="text-[11px] text-[var(--text-secondary)] leading-snug">{String(log.message).slice(0, 120)}</span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* How It Works */}
          <section>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">How the AI Trades</h2>
            <div className="rounded-xl border border-[var(--border)] p-5 space-y-3 text-[12px] text-[var(--text-secondary)] leading-relaxed" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              <div className="flex gap-3"><span className="text-[var(--blue)] font-bold">1.</span><span>Every 30 min, the bot scans BTC, ETH, SOL, BNB, Gold for trading setups</span></div>
              <div className="flex gap-3"><span className="text-[var(--blue)] font-bold">2.</span><span>Uses <b className="text-[var(--text-primary)]">BB Squeeze</b> (Sharpe 1.89) and <b className="text-[var(--text-primary)]">EMA Cross</b> (Sharpe 1.75) — backtested on 6 months of data</span></div>
              <div className="flex gap-3"><span className="text-[var(--blue)] font-bold">3.</span><span>Claude AI analyzes context and filters false signals — only trades when AI and technical analysis agree</span></div>
              <div className="flex gap-3"><span className="text-[var(--blue)] font-bold">4.</span><span>Risk Manager validates every trade: min R:R 1.5x, max 2% risk, ATR-based stop loss</span></div>
              <div className="flex gap-3"><span className="text-[var(--blue)] font-bold">5.</span><span>Safety system auto-halts trading if drawdown exceeds 15% or daily loss exceeds 3%</span></div>
            </div>

            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3 mt-6">How to Fund</h2>
            <div className="rounded-xl border border-[var(--border)] p-5 space-y-3 text-[12px] text-[var(--text-secondary)] leading-relaxed" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              <div className="flex gap-3"><span className="text-[var(--green)] font-bold">1.</span><span>Create a <b className="text-[var(--text-primary)]">Binance account</b> and verify identity (KYC)</span></div>
              <div className="flex gap-3"><span className="text-[var(--green)] font-bold">2.</span><span>Deposit USD via bank transfer or card, buy <b className="text-[var(--text-primary)]">USDT</b></span></div>
              <div className="flex gap-3"><span className="text-[var(--green)] font-bold">3.</span><span>Create API key (<b className="text-[var(--text-primary)]">NO withdrawal permission</b>) — bot can only trade, never withdraw</span></div>
              <div className="flex gap-3"><span className="text-[var(--green)] font-bold">4.</span><span>To withdraw: manually sell USDT in Binance app, transfer to bank</span></div>
              <div className="mt-2 p-3 rounded-lg border text-[11px]" style={{ borderColor: 'var(--green)', background: 'var(--green)', color: 'white' }}>
                Your money stays on YOUR Binance account. The bot only has API access for trading, never withdrawal.
              </div>
            </div>
          </section>
        </div>

        {/* Trade History */}
        <section>
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Trade History ({closedTrades.length})</h2>
          {closedTrades.length > 0 ? (
            <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              <table className="w-full">
                <thead><tr className="border-b border-[var(--border)]">
                  {['Instrument', 'Dir', 'Entry', 'Exit', 'P&L', '%', 'Result', 'Strategy', 'Date'].map(h => (
                    <th key={h} className="text-left text-[9px] text-[var(--text-muted)] tracking-wider font-semibold px-4 py-2">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {closedTrades.map((t, i) => {
                    const pnl = Number(t.pnl_aed || 0), isWin = pnl > 0
                    return (
                      <tr key={i} className="border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)]">
                        <td className="px-4 py-2 font-bold text-xs text-[var(--text-primary)]">{String(t.instrument)}</td>
                        <td className={cn('px-4 py-2 text-xs font-bold', String(t.direction) === 'long' ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{String(t.direction).toUpperCase()}</td>
                        <td className="px-4 py-2 mono text-xs text-[var(--text-secondary)]">${Number(t.entry_price).toFixed(2)}</td>
                        <td className="px-4 py-2 mono text-xs text-[var(--text-secondary)]">${Number(t.exit_price).toFixed(2)}</td>
                        <td className={cn('px-4 py-2 mono text-xs font-bold', isWin ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{isWin ? '+' : ''}{pnl.toFixed(0)}</td>
                        <td className={cn('px-4 py-2 mono text-xs', isWin ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{Number(t.pnl_pct || 0).toFixed(2)}%</td>
                        <td className="px-4 py-2"><span className={cn('text-[9px] font-bold px-2 py-0.5 rounded', String(t.exit_reason) === 'take_profit' ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]')}>{String(t.exit_reason) === 'take_profit' ? 'TARGET' : 'STOP LOSS'}</span></td>
                        <td className="px-4 py-2 text-[10px] text-[var(--text-muted)]">{String(t.signal_reason ?? '').slice(0, 25)}</td>
                        <td className="px-4 py-2 text-[10px] text-[var(--text-muted)] mono">{new Date(String(t.entry_time)).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] p-6 text-center text-[var(--text-muted)] text-sm" style={{ background: 'var(--bg-panel)' }}>No closed trades yet</div>
          )}
        </section>

        {/* Market Prices */}
        <section>
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Market Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT'].map(sym => {
              const p = prices[sym], price = Number(p?.price ?? 0), pct = Number(p?.change_pct_24h ?? 0)
              return (
                <div key={sym} className="rounded-lg border border-[var(--border)] p-3" style={{ background: 'var(--bg-panel)' }}>
                  <div className="text-[9px] text-[var(--text-muted)] tracking-wider mb-1">{sym}</div>
                  <div className="text-sm font-bold mono text-[var(--text-primary)]">${price >= 1000 ? price.toLocaleString('en', { maximumFractionDigits: 0 }) : price.toFixed(2)}</div>
                  <div className={cn('text-[10px] font-bold mono', pct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</div>
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
