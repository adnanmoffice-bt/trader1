'use client'
import { useEffect, useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import type { SafetyStatus } from '@/lib/safety'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }
function fmt(n: number, prefix = '') {
  if (Math.abs(n) >= 1000) return `${prefix}${n.toLocaleString('en', { maximumFractionDigits: 0 })}`
  return `${prefix}${n.toFixed(2)}`
}

interface UserInfo { id: string; email: string; name: string }

// ═══════════════════════════════════════════════════════════════════════════════
// SAFETY GAUGE
// ═══════════════════════════════════════════════════════════════════════════════

function Gauge({ label, value, max, unit, danger }: { label: string; value: number; max: number; unit: string; danger: boolean }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = danger ? '#ff3366' : pct > 70 ? '#ffcc00' : '#00ffa3'
  return (
    <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-xl p-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-bold text-[#44446a] tracking-wider uppercase">{label}</span>
        <span className="text-[10px] font-bold" style={{ color }}>{value.toFixed(1)}{unit} / {max}{unit}</span>
      </div>
      <div className="h-2 bg-[#141428] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INVESTOR PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function InvestorPage() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [safety, setSafety] = useState<SafetyStatus | null>(null)
  const [signals, setSignals] = useState<Array<Record<string, unknown>>>([])
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([])
  const [demoData, setDemoData] = useState<{ session: Record<string, unknown> | null; trades: Array<Record<string, unknown>> }>({ session: null, trades: [] })
  const [prices, setPrices] = useState<Record<string, Record<string, unknown>>>({})
  const [killLoading, setKillLoading] = useState(false)
  const [clock, setClock] = useState('')
  const router = useRouter()

  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) setUser(d.user)
      else router.push('/login')
    }).catch(() => router.push('/login'))

    fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
    fetch('/api/signals?limit=10').then(r => r.json()).then(d => { if (d.data) setSignals(d.data) }).catch(() => {})
    fetch('/api/agent-logs').then(r => r.json()).then(d => { if (d.data) setLogs(d.data) }).catch(() => {})
    fetch('/api/demo').then(r => r.json()).then(d => {
      if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] })
    }).catch(() => {})
    fetch('/api/prices').then(r => r.json()).then(d => {
      if (d.data) {
        const map: Record<string, Record<string, unknown>> = {}
        d.data.forEach((p: Record<string, unknown>) => { map[String(p.symbol)] = p })
        setPrices(map)
      }
    }).catch(() => {})

    const interval = setInterval(() => {
      fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
      fetch('/api/demo').then(r => r.json()).then(d => {
        if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] })
      }).catch(() => {})
    }, 30000)
    return () => clearInterval(interval)
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  async function handleKillSwitch() {
    if (!confirm('KILL SWITCH: Zaustavi SVE trgovanje na 24h?')) return
    setKillLoading(true)
    await fetch('/api/kill-switch', { method: 'POST', body: JSON.stringify({}) })
    setSafety(s => s ? { ...s, killSwitchActive: true, safe: false, reason: 'Kill switch is active' } : s)
    setKillLoading(false)
  }

  const s = demoData.session
  const openTrades = demoData.trades.filter(t => !t.exit_time)
  const closedTrades = demoData.trades.filter(t => t.exit_time)
  const demoPnl = Number(s?.total_pnl || 0)
  const demoCapital = Number(s?.initial_capital || 5000)

  return (
    <div className="min-h-screen bg-[#03030a] text-[#e2e2f5]">
      {/* ═══ HEADER ═══ */}
      <header className="flex items-center justify-between px-6 h-14 bg-[#07070f] border-b border-[#1a1a2e]">
        <div className="flex items-center gap-4">
          <span className="text-lg font-black">APEX</span>
          <span className="flex items-center gap-1.5 text-[9px] font-bold text-[#00ffa3] tracking-[0.15em] px-2 py-1 border border-[rgba(0,255,163,0.2)] rounded bg-[rgba(0,255,163,0.05)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ffa3] animate-pulse" />LIVE
          </span>
          <a href="/" className="text-[10px] text-[#44446a] hover:text-[#00ccff] transition-colors">Terminal View</a>
        </div>
        <div className="flex items-center gap-5 text-[11px]">
          <span className="text-[#00ccff] mono font-bold">{clock}</span>
          <span className="text-[#7878aa]">{user?.name}</span>
          <button onClick={handleLogout} className="text-[#44446a] hover:text-[#ff3366] transition-colors text-[10px]">Logout</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ═══ PORTFOLIO OVERVIEW ═══ */}
        <section>
          <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase mb-3">Portfolio Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { l: 'KAPITAL', v: `AED ${demoCapital.toLocaleString()}`, cls: 'text-[#e2e2f5]' },
              { l: 'TRENUTNO', v: `AED ${Number(s?.final_capital || demoCapital).toLocaleString()}`, cls: demoPnl >= 0 ? 'text-[#00ffa3]' : 'text-[#ff3366]' },
              { l: 'UKUPNI P&L', v: `${demoPnl >= 0 ? '+' : ''}AED ${Math.abs(demoPnl).toLocaleString()}`, cls: demoPnl >= 0 ? 'text-[#00ffa3]' : 'text-[#ff3366]' },
              { l: 'WIN RATE', v: `${(Number(s?.win_count || 0) + Number(s?.loss_count || 0)) > 0 ? (Number(s?.win_count || 0) / (Number(s?.win_count || 0) + Number(s?.loss_count || 0)) * 100).toFixed(0) : '—'}%`, cls: 'text-[#ffcc00]' },
              { l: 'UKUPNO TRADES', v: `${s?.total_trades ?? 0}`, cls: 'text-[#00ccff]' },
              { l: 'OTVORENO', v: `${openTrades.length} pozicija`, cls: 'text-[#9966ff]' },
            ].map(st => (
              <div key={st.l} className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-xl p-4">
                <div className="text-[9px] text-[#44446a] tracking-wider mb-2">{st.l}</div>
                <div className={cn('text-lg font-black mono', st.cls)}>{st.v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ SAFETY DASHBOARD ═══ */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase">Sigurnosni Sistem</h2>
            <div className="flex items-center gap-3">
              <span className={cn('flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded',
                safety?.safe ? 'bg-[rgba(0,255,163,0.08)] text-[#00ffa3]' : 'bg-[rgba(255,51,102,0.08)] text-[#ff3366]'
              )}>
                <span className={cn('w-2 h-2 rounded-full', safety?.safe ? 'bg-[#00ffa3]' : 'bg-[#ff3366] animate-pulse')} />
                {safety?.safe ? 'SVE OK' : safety?.reason ?? 'PROBLEM'}
              </span>
              <button
                onClick={handleKillSwitch} disabled={killLoading}
                className="px-3 py-1.5 text-[9px] font-black tracking-wider bg-[rgba(255,51,102,0.12)] text-[#ff3366] border border-[rgba(255,51,102,0.3)] rounded hover:bg-[rgba(255,51,102,0.25)] transition-all disabled:opacity-50"
              >{killLoading ? '...' : 'KILL SWITCH'}</button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Gauge label="Drawdown" value={(safety?.drawdownPct ?? 0) * 100} max={15} unit="%" danger={!safety?.drawdownOk} />
            <Gauge label="Dnevni Gubitak" value={(safety?.dailyLossPct ?? 0) * 100} max={3} unit="%" danger={!safety?.dailyLossOk} />
            <Gauge label="Otvorene Pozicije" value={safety?.openPositions ?? 0} max={3} unit="" danger={!safety?.positionsOk} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-[10px]">
            <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg p-3">
              <span className="text-[#44446a]">Max Drawdown Limit: </span>
              <span className="text-[#ffcc00] font-bold">15%</span>
              <span className="text-[#44446a]"> — ako portfolio padne 15% od peak-a, bot se automatski gasi</span>
            </div>
            <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg p-3">
              <span className="text-[#44446a]">Dnevni Loss Limit: </span>
              <span className="text-[#ffcc00] font-bold">3%</span>
              <span className="text-[#44446a]"> — max gubitak u jednom danu, nakon toga stop</span>
            </div>
            <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg p-3">
              <span className="text-[#44446a]">Risk Per Trade: </span>
              <span className="text-[#ffcc00] font-bold">2%</span>
              <span className="text-[#44446a]"> — nikad vise od 2% kapitala u jednom trade-u</span>
            </div>
          </div>
        </section>

        {/* ═══ ACTIVE POSITIONS ═══ */}
        <section>
          <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase mb-3">
            Otvorene Pozicije ({openTrades.length})
          </h2>
          {openTrades.length === 0 ? (
            <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-xl p-6 text-center text-[#44446a] text-sm">
              Nema otvorenih pozicija — bot ceka signal
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {openTrades.map((t, i) => {
                const dir = String(t.direction)
                const entry = Number(t.entry_price)
                const cur = Number(t.current_price || entry)
                const livePnl = Number(t.live_pnl_aed || 0)
                const livePct = Number(t.live_pnl_pct || 0)
                const isUp = livePnl >= 0
                return (
                  <div key={i} className={cn('bg-[#0f0f1e] border border-[#1a1a2e] rounded-xl overflow-hidden',
                    dir === 'long' ? 'border-l-4 border-l-[#00ffa3]' : 'border-l-4 border-l-[#ff3366]'
                  )}>
                    <div className="flex items-center justify-between p-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm">{String(t.instrument)}</span>
                          <span className={cn('text-[9px] font-black px-2 py-0.5 rounded',
                            dir === 'long' ? 'bg-[rgba(0,255,163,0.15)] text-[#00ffa3]' : 'bg-[rgba(255,51,102,0.15)] text-[#ff3366]'
                          )}>{dir.toUpperCase()}</span>
                        </div>
                        <div className="text-[10px] text-[#7878aa]">{String(t.signal_reason)}</div>
                      </div>
                      <div className="text-right">
                        <div className={cn('text-lg font-black mono', isUp ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>
                          {isUp ? '+' : ''}{livePnl.toFixed(0)} AED
                        </div>
                        <div className={cn('text-[11px] mono', isUp ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>
                          {isUp ? '+' : ''}{livePct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-px bg-[#1a1a2e]">
                      {[
                        { l: 'ULAZ', v: `$${entry >= 1000 ? entry.toLocaleString('en', { maximumFractionDigits: 0 }) : entry.toFixed(2)}` },
                        { l: 'TRENUTNA', v: `$${cur >= 1000 ? cur.toLocaleString('en', { maximumFractionDigits: 0 }) : cur.toFixed(2)}` },
                        { l: 'STOP LOSS', v: `$${Number(t.stop_loss).toFixed(2)}` },
                        { l: 'TARGET', v: `$${Number(t.take_profit).toFixed(2)}` },
                      ].map(c => (
                        <div key={c.l} className="bg-[#07070f] p-2.5 text-center">
                          <div className="text-[8px] text-[#44446a] mb-1">{c.l}</div>
                          <div className="text-[11px] font-bold mono text-[#e2e2f5]">{c.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ═══ AI DECISION LOG ═══ */}
        <section>
          <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase mb-3">
            AI Decisions — Sta Bot Radi i Zasto
          </h2>
          <div className="bg-[#07070f] border border-[#1a1a2e] rounded-xl overflow-hidden">
            {logs.slice(0, 20).map((log, i) => {
              const agent = String(log.agent ?? '')
              const level = String(log.level ?? 'info')
              const msg = String(log.message ?? '')
              const time = log.created_at ? new Date(String(log.created_at)).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : ''
              const dotColor = level === 'ok' ? 'bg-[#00ffa3]' : level === 'warn' ? 'bg-[#ffcc00]' : level === 'error' ? 'bg-[#ff3366]' : 'bg-[#44446a]'
              return (
                <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-b border-[#0f0f1e] hover:bg-[#0a0a16]">
                  <div className={cn('w-2 h-2 rounded-full mt-1 flex-shrink-0', dotColor)} />
                  <span className="text-[10px] text-[#44446a] mono w-12 flex-shrink-0">{time}</span>
                  <span className="text-[10px] font-bold text-[#9966ff] w-20 flex-shrink-0">{agent}</span>
                  <span className="text-[11px] text-[#7878aa] leading-snug">{msg}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* ═══ TRADE HISTORY ═══ */}
        <section>
          <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase mb-3">
            Historija Trejdova ({closedTrades.length})
          </h2>
          {closedTrades.length > 0 ? (
            <div className="bg-[#07070f] border border-[#1a1a2e] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1a1a2e]">
                    {['Instrument', 'Smjer', 'Ulaz', 'Izlaz', 'P&L', '%', 'Razlog', 'Strategija', 'Datum'].map(h => (
                      <th key={h} className="text-left text-[9px] text-[#44446a] tracking-wider font-semibold px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t, i) => {
                    const pnl = Number(t.pnl_aed || 0)
                    const isWin = pnl > 0
                    return (
                      <tr key={i} className="border-b border-[#0f0f1e] hover:bg-[#0a0a16]">
                        <td className="px-4 py-2 font-bold text-xs text-[#e2e2f5]">{String(t.instrument)}</td>
                        <td className={cn('px-4 py-2 text-xs font-bold', String(t.direction) === 'long' ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>{String(t.direction).toUpperCase()}</td>
                        <td className="px-4 py-2 mono text-xs text-[#7878aa]">${Number(t.entry_price).toFixed(2)}</td>
                        <td className="px-4 py-2 mono text-xs text-[#7878aa]">${Number(t.exit_price).toFixed(2)}</td>
                        <td className={cn('px-4 py-2 mono text-xs font-bold', isWin ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>
                          {isWin ? '+' : ''}{pnl.toFixed(0)} AED
                        </td>
                        <td className={cn('px-4 py-2 mono text-xs', isWin ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>
                          {Number(t.pnl_pct || 0).toFixed(2)}%
                        </td>
                        <td className="px-4 py-2">
                          <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded',
                            String(t.exit_reason) === 'take_profit' ? 'bg-[rgba(0,255,163,0.1)] text-[#00ffa3]' : 'bg-[rgba(255,51,102,0.1)] text-[#ff3366]'
                          )}>{String(t.exit_reason) === 'take_profit' ? 'TARGET' : 'STOP LOSS'}</span>
                        </td>
                        <td className="px-4 py-2 text-[10px] text-[#44446a]">{String(t.signal_reason ?? '').slice(0, 30)}</td>
                        <td className="px-4 py-2 text-[10px] text-[#44446a] mono">
                          {new Date(String(t.entry_time)).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-xl p-6 text-center text-[#44446a] text-sm">
              Nema zatvorenih trejdova
            </div>
          )}
        </section>

        {/* ═══ HOW IT WORKS + FUNDING ═══ */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase mb-3">Kako AI Trguje</h2>
            <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-xl p-5 space-y-3 text-[12px] text-[#7878aa] leading-relaxed">
              <div className="flex gap-3"><span className="text-[#00ccff] font-bold">1.</span><span>Svakih 30 minuta bot skenira BTC, ETH, SOL, BNB, Gold za trading prilike</span></div>
              <div className="flex gap-3"><span className="text-[#00ccff] font-bold">2.</span><span>Koristi <b className="text-[#e2e2f5]">BB Squeeze</b> (Sharpe 1.89) i <b className="text-[#e2e2f5]">EMA Cross</b> (Sharpe 1.75) — backtested na 6 mjeseci podataka</span></div>
              <div className="flex gap-3"><span className="text-[#00ccff] font-bold">3.</span><span>Claude AI analizira kontekst i filtrira lazne signale — samo trguje kad se AI i tehnicka analiza slazu</span></div>
              <div className="flex gap-3"><span className="text-[#00ccff] font-bold">4.</span><span>Risk Manager validira svaki trade: min R:R 1.5x, max 2% rizik, SL baziran na ATR volatilnosti</span></div>
              <div className="flex gap-3"><span className="text-[#00ccff] font-bold">5.</span><span>Sigurnosni sistem automatski gasi trading ako drawdown predje 15% ili dnevni gubitak 3%</span></div>
            </div>
          </div>
          <div>
            <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase mb-3">Funding / Kako Uloziti</h2>
            <div className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-xl p-5 space-y-3 text-[12px] text-[#7878aa] leading-relaxed">
              <div className="flex gap-3"><span className="text-[#00ffa3] font-bold">1.</span><span>Otvori <b className="text-[#e2e2f5]">Binance racun</b> (binance.com) i verificiraj identitet (KYC)</span></div>
              <div className="flex gap-3"><span className="text-[#00ffa3] font-bold">2.</span><span>Uplati AED na Binance putem <b className="text-[#e2e2f5]">bank transfer-a</b> ili kartice</span></div>
              <div className="flex gap-3"><span className="text-[#00ffa3] font-bold">3.</span><span>Kupi <b className="text-[#e2e2f5]">USDT</b> (stablecoin) — bot trguje u USDT parovima</span></div>
              <div className="flex gap-3"><span className="text-[#00ffa3] font-bold">4.</span><span>Napravi API kljuc (<b className="text-[#e2e2f5]">BEZ withdrawal dozvole</b>) — bot moze samo trgovati, ne moze povuci novac</span></div>
              <div className="flex gap-3"><span className="text-[#00ffa3] font-bold">5.</span><span>Za povlacenje: ti rucno prodas USDT za AED u Binance app i prebacis na banku</span></div>
              <div className="mt-2 p-3 bg-[rgba(0,255,163,0.05)] border border-[rgba(0,255,163,0.15)] rounded-lg text-[11px] text-[#00ffa3]">
                Tvoj novac je uvijek na TVOM Binance racunu. Bot ima samo API pristup za trgovanje, bez mogucnosti povlacenja.
              </div>
            </div>
          </div>
        </section>

        {/* ═══ MARKET PRICES ═══ */}
        <section>
          <h2 className="text-[11px] font-bold text-[#44446a] tracking-widest uppercase mb-3">Trzisni Pregled</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT'].map(sym => {
              const p = prices[sym]
              const price = Number(p?.price ?? 0)
              const pct = Number(p?.change_pct_24h ?? 0)
              return (
                <div key={sym} className="bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg p-3">
                  <div className="text-[9px] text-[#44446a] tracking-wider mb-1">{sym}</div>
                  <div className="text-sm font-bold mono text-[#e2e2f5]">
                    ${price >= 1000 ? price.toLocaleString('en', { maximumFractionDigits: 0 }) : price.toFixed(2)}
                  </div>
                  <div className={cn('text-[10px] font-bold mono', pct >= 0 ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </div>
                </div>
              )
            })}
          </div>
        </section>

      </main>
    </div>
  )
}
