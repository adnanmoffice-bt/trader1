'use client'
import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { RealtimeProvider } from '@/components/providers/RealtimeProvider'
import type { MarketData, OHLCV } from '@/types'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }
function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 10000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(2)
}
const SYM: Record<string, string> = { 'BTC/USD': 'BTC', 'ETH/USD': 'ETH', 'SOL/USD': 'SOL', 'BNB/USD': 'BNB', 'XAU/USD': 'GOLD', 'BRENT': 'BRENT', 'SPY': 'SPY', 'QQQ': 'QQQ' }

// ═══ CHART ═══
function Chart({ candles, symbol }: { candles: OHLCV[]; symbol: string }) {
  const W = 900, H = 380, VH = 50, PR = 65, PT = 10, PB = 16
  const CH = H - VH - PB - PT, CW = W - PR
  if (!candles.length) return <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Loading chart...</div>
  const d = candles.slice(-100)
  const pMin = Math.min(...d.map(c => c.low)) * 0.999, pMax = Math.max(...d.map(c => c.high)) * 1.001
  const vMax = Math.max(...d.map(c => c.volume)) || 1
  const gap = CW / d.length, cw = Math.max(1, gap * 0.6)
  const yP = (p: number) => PT + (1 - (p - pMin) / (pMax - pMin)) * CH
  const cls = d.map(c => c.close)
  const ema: number[] = [cls[0]]
  for (let i = 1; i < cls.length; i++) ema.push(cls[i] * (2 / 21) + ema[i - 1] * (1 - 2 / 21))
  const ePath = ema.map((v, i) => `${i ? 'L' : 'M'}${i * gap + gap / 2},${yP(v)}`).join(' ')
  const last = d[d.length - 1]?.close ?? 0, lastY = yP(last)
  const step = (pMax - pMin) / 5
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: 6 }, (_, i) => pMin + step * i).map((p, i) => (
        <g key={i}><line x1={0} y1={yP(p)} x2={CW} y2={yP(p)} stroke="var(--chart-grid)" strokeWidth={0.5} />
        <text x={CW + 4} y={yP(p) + 3} fill="var(--text-muted)" fontSize={8} fontFamily="monospace">{p >= 1000 ? p.toFixed(0) : p.toFixed(2)}</text></g>
      ))}
      {d.map((c, i) => <rect key={`v${i}`} x={i * gap + (gap - cw) / 2} y={H - PB - (c.volume / vMax) * VH} width={cw} height={(c.volume / vMax) * VH} fill={c.close >= c.open ? 'var(--chart-up)' : 'var(--chart-dn)'} opacity={0.1} />)}
      <path d={ePath} fill="none" stroke="var(--chart-ema)" strokeWidth={1} opacity={0.5} />
      {d.map((c, i) => {
        const x = i * gap + gap / 2, up = c.close >= c.open, col = up ? 'var(--chart-up)' : 'var(--chart-dn)'
        const bt = yP(Math.max(c.open, c.close)), bb = yP(Math.min(c.open, c.close))
        return <g key={i}><line x1={x} y1={yP(c.high)} x2={x} y2={yP(c.low)} stroke={col} strokeWidth={0.7} /><rect x={x - cw / 2} y={bt} width={cw} height={Math.max(bb - bt, 0.5)} fill={col} /></g>
      })}
      <line x1={0} y1={lastY} x2={CW} y2={lastY} stroke="var(--chart-price-bg)" strokeWidth={0.5} strokeDasharray="3 2" />
      <rect x={CW} y={lastY - 8} width={PR - 2} height={16} rx={2} fill="var(--chart-price-bg)" />
      <text x={CW + 3} y={lastY + 4} fill="white" fontSize={8} fontWeight="bold" fontFamily="monospace">{last >= 1000 ? last.toFixed(0) : last.toFixed(2)}</text>
      <text x={6} y={18} fill="var(--text-muted)" fontSize={10} fontWeight="bold" fontFamily="monospace">{symbol} 1H</text>
    </svg>
  )
}

// ═══ GAUGE ═══
function Gauge({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = pct > 75 ? 'var(--red)' : pct > 50 ? 'var(--amber)' : 'var(--green)'
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-[var(--text-muted)] w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="mono font-bold w-16 text-right" style={{ color }}>{value.toFixed(1)}{unit}/{max}{unit}</span>
    </div>
  )
}

// ═══ MAIN ═══
function Dashboard() {
  const prices = useStore(s => s.prices)
  const [sym, setSym] = useState('BTC/USD')
  const [candles, setCandles] = useState<OHLCV[]>([])
  const [demo, setDemo] = useState<{ session: Record<string, any> | null; trades: any[] }>({ session: null, trades: [] })
  const [safety, setSafety] = useState<Record<string, any> | null>(null)

  useEffect(() => {
    const st = useStore.getState()
    fetch('/api/prices').then(r => r.json()).then(d => {
      if (d.data && Array.isArray(d.data)) st.setPrices(d.data.map((i: any) => ({ ...i, price: +i.price || 0, change_pct_24h: +i.change_pct_24h || 0, volume_24h: +i.volume_24h || 0, high_24h: +i.high_24h || 0, low_24h: +i.low_24h || 0 })))
    }).catch(() => {})
    fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
    const t = setInterval(() => {
      fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
      fetch('/api/prices').then(r => r.json()).then(d => { if (d.data && Array.isArray(d.data)) st.setPrices(d.data.map((i: any) => ({ ...i, price: +i.price || 0, change_pct_24h: +i.change_pct_24h || 0, volume_24h: +i.volume_24h || 0, high_24h: +i.high_24h || 0, low_24h: +i.low_24h || 0 }))) }).catch(() => {})
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const fetchC = useCallback((s: string) => {
    fetch(`/api/prices?symbol=${encodeURIComponent(s)}&candles=true&interval=1h&limit=100`).then(r => r.json()).then(d => { if (d.data) setCandles(d.data) }).catch(() => {})
  }, [])
  useEffect(() => { fetchC(sym) }, [sym, fetchC])

  const s = demo.session
  const openT = demo.trades.filter((t: any) => !t.exit_time)
  const pnl = +(s?.total_pnl || 0)
  const cap = +(s?.initial_capital || 5000)
  const wins = +(s?.win_count || 0), losses = +(s?.loss_count || 0)
  const wr = wins + losses > 0 ? (wins / (wins + losses) * 100) : 0
  const instruments = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT']
  const allSyms = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT', 'SPY', 'QQQ']
  const sp = prices[sym]

  return (
    <div className="p-4 lg:p-6">
      {/* 2-column layout: lg breakpoint = 1024px */}
      <div className="flex flex-col lg:flex-row gap-5">

        {/* ═══ LEFT COLUMN (65%) ═══ */}
        <div className="flex-1 lg:w-[65%] space-y-4">

          {/* Chart panel */}
          <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
            {/* Instrument tabs inside chart */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
              {instruments.map(s2 => (
                <button key={s2} onClick={() => setSym(s2)} className={cn(
                  'px-3 py-1 text-[11px] font-semibold rounded-md transition-all',
                  sym === s2 ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                )}>{SYM[s2] ?? s2}</button>
              ))}
              <div className="flex-1" />
              {sp && (
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="mono font-bold text-[var(--text-primary)]">{fmt(sp.price)}</span>
                  <span className={cn('mono font-bold', (sp.change_pct_24h ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                    {(sp.change_pct_24h ?? 0) >= 0 ? '+' : ''}{(sp.change_pct_24h ?? 0).toFixed(2)}%
                  </span>
                  <span className="text-[var(--text-muted)]">H: {fmt(sp.high_24h)}</span>
                  <span className="text-[var(--text-muted)]">L: {fmt(sp.low_24h)}</span>
                </div>
              )}
            </div>
            <div className="h-[420px]">
              <Chart candles={candles} symbol={sym} />
            </div>
          </div>

          {/* Market prices row */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {allSyms.map(s2 => {
              const p = prices[s2]
              if (!p) return null
              const pct = p.change_pct_24h ?? 0
              return (
                <button key={s2} onClick={() => setSym(s2)} className="rounded-lg border border-[var(--border)] p-2.5 text-left hover:border-[var(--blue)] transition-colors" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
                  <div className="text-[9px] font-bold text-[var(--text-muted)] tracking-wider">{SYM[s2] ?? s2}</div>
                  <div className="text-[13px] font-bold mono text-[var(--text-primary)] mt-0.5">{p.price >= 1000 ? p.price.toLocaleString('en', { maximumFractionDigits: 0 }) : p.price.toFixed(2)}</div>
                  <div className={cn('text-[10px] font-bold mono', pct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ═══ RIGHT COLUMN (35%) ═══ */}
        <div className="lg:w-[35%] space-y-4">

          {/* Portfolio summary */}
          <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
            <div className="px-4 py-2.5 border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
              <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Portfolio</span>
            </div>
            <div className="p-4">
              <div className="flex justify-between items-end mb-3">
                <div>
                  <div className="text-[10px] text-[var(--text-muted)]">Current Value</div>
                  <div className="text-2xl font-black mono text-[var(--text-primary)]">AED {(cap + pnl).toLocaleString()}</div>
                </div>
                <div className={cn('text-right text-sm font-bold mono', pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(0)} AED
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { l: 'Capital', v: cap.toLocaleString() },
                  { l: 'Win Rate', v: `${wr.toFixed(0)}%` },
                  { l: 'Trades', v: `${wins + losses}` },
                  { l: 'W/L', v: `${wins}/${losses}` },
                ].map(x => (
                  <div key={x.l} className="text-center p-2 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="text-[8px] text-[var(--text-muted)]">{x.l}</div>
                    <div className="text-[12px] font-bold mono text-[var(--text-primary)]">{x.v}</div>
                  </div>
                ))}
              </div>
              {s?.max_drawdown != null && (
                <div className="text-[10px] text-[var(--text-muted)]">Max Drawdown: <span className="font-bold text-[var(--amber)]">{(+(s.max_drawdown) * 100).toFixed(1)}%</span></div>
              )}
            </div>
          </div>

          {/* Open positions */}
          <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex justify-between" style={{ background: 'var(--bg-secondary)' }}>
              <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Open Positions</span>
              <span className="text-[10px] font-bold text-[var(--blue)]">{openT.length}</span>
            </div>
            {openT.length === 0 ? (
              <div className="p-6 text-center text-[var(--text-muted)] text-xs">No open positions — bot waiting for signal</div>
            ) : (
              <div className="divide-y divide-[var(--border-light)]">
                {openT.map((t: any, i: number) => {
                  const dir = String(t.direction), entry = +t.entry_price, cur = +(t.current_price || entry)
                  const livePnl = +(t.live_pnl_aed || 0), livePct = +(t.live_pnl_pct || 0), isUp = livePnl >= 0
                  const sl = +t.stop_loss, tp = +t.take_profit
                  const slDist = entry > 0 ? (Math.abs(cur - sl) / cur * 100) : 0
                  const tpDist = entry > 0 ? (Math.abs(tp - cur) / cur * 100) : 0
                  const openedAt = t.entry_time ? new Date(t.entry_time) : null
                  const elapsed = openedAt ? Math.floor((Date.now() - openedAt.getTime()) / 60000) : 0
                  const hrs = Math.floor(elapsed / 60), mins = elapsed % 60
                  return (
                    <div key={i} className="p-3 hover:bg-[var(--bg-hover)] transition-colors">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full', dir === 'long' ? 'bg-[var(--green)]' : 'bg-[var(--red)]')} />
                          <span className="font-bold text-[12px] text-[var(--text-primary)]">{SYM[String(t.instrument)] ?? t.instrument}</span>
                          <span className={cn('text-[9px] font-black px-1.5 py-0.5 rounded',
                            dir === 'long' ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]'
                          )}>{dir.toUpperCase()}</span>
                        </div>
                        <div className="text-right">
                          <span className={cn('text-[13px] font-black mono', isUp ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                            {isUp ? '+' : ''}{livePnl.toFixed(0)} AED
                          </span>
                          <span className={cn('text-[10px] mono ml-1', isUp ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                            ({isUp ? '+' : ''}{livePct.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                        <div className="text-[var(--text-muted)]">Entry: <span className="mono text-[var(--text-secondary)]">{fmt(entry)}</span></div>
                        <div className="text-[var(--text-muted)]">Current: <span className="mono font-bold text-[var(--text-primary)]">{fmt(cur)}</span></div>
                        <div className="text-[var(--text-muted)]">SL: <span className="mono text-[var(--red)]">{fmt(sl)}</span> <span className="text-[var(--amber)]">({slDist.toFixed(1)}% away)</span></div>
                        <div className="text-[var(--text-muted)]">TP: <span className="mono text-[var(--green)]">{fmt(tp)}</span> <span className="text-[var(--blue)]">({tpDist.toFixed(1)}% away)</span></div>
                        <div className="text-[var(--text-muted)]">Open: <span className="text-[var(--text-secondary)]">{hrs}h {mins}m</span></div>
                        <div className="text-[var(--text-muted)]">Strategy: <span className="text-[var(--purple)] font-bold">{String(t.signal_reason ?? '').split(' ')[0]}</span></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Safety gauges */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-2" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Safety</span>
              <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded',
                safety?.safe ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]'
              )}>{safety?.safe ? 'ALL OK' : String(safety?.reason ?? 'CHECKING...')}</span>
            </div>
            <Gauge label="Drawdown" value={(+(safety?.drawdownPct ?? 0)) * 100} max={15} unit="%" />
            <Gauge label="Daily Loss" value={(+(safety?.dailyLossPct ?? 0)) * 100} max={3} unit="%" />
            <Gauge label="Positions" value={+(safety?.openPositions ?? 0)} max={3} unit="" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <RealtimeProvider><Dashboard /></RealtimeProvider>
}
