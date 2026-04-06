'use client'
import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { RealtimeProvider } from '@/components/providers/RealtimeProvider'
import type { OHLCV } from '@/types'

const S: Record<string, string> = { 'BTC/USD': 'BTC', 'ETH/USD': 'ETH', 'SOL/USD': 'SOL', 'BNB/USD': 'BNB', 'XAU/USD': 'GOLD', 'BRENT': 'OIL', 'SPY': 'SPY', 'QQQ': 'QQQ' }
const f = (n: number) => n >= 10000 ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n >= 100 ? n.toFixed(2) : n.toFixed(2)

// ═══ CHART ═══
function Chart({ candles, symbol }: { candles: OHLCV[]; symbol: string }) {
  if (!candles.length) return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-3)' }}>LOADING...</div>
  const W = 800, H = 300, VH = 35, PR = 55, PT = 4, PB = 4, CH = H - VH - PB - PT, CW = W - PR
  const d = candles.slice(-80)
  const lo = Math.min(...d.map(c => c.low)) * 0.999, hi = Math.max(...d.map(c => c.high)) * 1.001, vm = Math.max(...d.map(c => c.volume)) || 1
  const g = CW / d.length, w = Math.max(1, g * 0.55)
  const y = (p: number) => PT + (1 - (p - lo) / (hi - lo)) * CH
  const cls = d.map(c => c.close), e: number[] = [cls[0]]
  for (let i = 1; i < cls.length; i++) e.push(cls[i] * 0.095 + e[i - 1] * 0.905)
  const ep = e.map((v, i) => `${i ? 'L' : 'M'}${i * g + g / 2},${y(v)}`).join(' ')
  const last = d[d.length - 1]?.close ?? 0, ly = y(last)
  const step = (hi - lo) / 4
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2, 3, 4].map(i => { const p = lo + step * i; return <g key={i}><line x1={0} y1={y(p)} x2={CW} y2={y(p)} stroke="var(--chart-grid)" strokeWidth={0.5} /><text x={CW + 2} y={y(p) + 3} fill="var(--text-3)" fontSize={7}>{f(p)}</text></g> })}
      {d.map((c, i) => <rect key={`v${i}`} x={i * g + (g - w) / 2} y={H - PB - (c.volume / vm) * VH} width={w} height={(c.volume / vm) * VH} fill={c.close >= c.open ? 'var(--chart-up)' : 'var(--chart-dn)'} opacity={0.08} />)}
      <path d={ep} fill="none" stroke="var(--chart-ema)" strokeWidth={0.8} opacity={0.5} />
      {d.map((c, i) => { const x = i * g + g / 2, up = c.close >= c.open, col = up ? 'var(--chart-up)' : 'var(--chart-dn)', bt = y(Math.max(c.open, c.close)), bb = y(Math.min(c.open, c.close)); return <g key={i}><line x1={x} y1={y(c.high)} x2={x} y2={y(c.low)} stroke={col} strokeWidth={0.6} /><rect x={x - w / 2} y={bt} width={w} height={Math.max(bb - bt, 0.4)} fill={col} /></g> })}
      <line x1={0} y1={ly} x2={CW} y2={ly} stroke="var(--chart-price)" strokeWidth={0.5} strokeDasharray="2 2" />
      <rect x={CW} y={ly - 6} width={PR - 1} height={12} rx={1} fill="var(--chart-price)" />
      <text x={CW + 2} y={ly + 3} fill="#fff" fontSize={7} fontWeight="bold">{f(last)}</text>
      <text x={3} y={10} fill="var(--text-3)" fontSize={8} fontWeight="bold">{symbol} 1H</text>
    </svg>
  )
}

function Dashboard() {
  const prices = useStore(s => s.prices)
  const signals = useStore(s => s.signals)
  const agentLogs = useStore(s => s.agentLogs)
  const [sym, setSym] = useState('BTC/USD')
  const [candles, setCandles] = useState<OHLCV[]>([])
  const [demo, setDemo] = useState<{ session: any; trades: any[] }>({ session: null, trades: [] })
  const [safety, setSafety] = useState<any>(null)
  const [profit, setProfit] = useState<any>(null)

  useEffect(() => {
    const st = useStore.getState()
    fetch('/api/prices').then(r => r.json()).then(d => { if (d.data) st.setPrices(d.data.map((i: any) => ({ ...i, price: +i.price || 0, change_pct_24h: +i.change_pct_24h || 0, volume_24h: +i.volume_24h || 0, high_24h: +i.high_24h || 0, low_24h: +i.low_24h || 0 }))) }).catch(() => {})
    fetch('/api/signals').then(r => r.json()).then(d => { if (d.data) st.setSignals(d.data) }).catch(() => {})
    fetch('/api/agent-logs').then(r => r.json()).then(d => { if (d.data) d.data.forEach((l: any) => st.addAgentLog(l)) }).catch(() => {})
    fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
    fetch('/api/profit').then(r => r.json()).then(d => { if (d.data) setProfit(d.data) }).catch(() => {})
    const t = setInterval(() => {
      fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
      fetch('/api/prices').then(r => r.json()).then(d => { if (d.data) st.setPrices(d.data.map((i: any) => ({ ...i, price: +i.price || 0, change_pct_24h: +i.change_pct_24h || 0, volume_24h: +i.volume_24h || 0, high_24h: +i.high_24h || 0, low_24h: +i.low_24h || 0 }))) }).catch(() => {})
    }, 20000)
    return () => clearInterval(t)
  }, [])

  const fc = useCallback((s: string) => { fetch(`/api/prices?symbol=${encodeURIComponent(s)}&candles=true&interval=1h&limit=80`).then(r => r.json()).then(d => { if (d.data) setCandles(d.data) }).catch(() => {}) }, [])
  useEffect(() => { fc(sym) }, [sym, fc])

  const ss = demo.session, openT = demo.trades.filter((t: any) => !t.exit_time), closedT = demo.trades.filter((t: any) => t.exit_time)
  const pnl = +(ss?.total_pnl || 0), cap = +(ss?.initial_capital || 5000), wins = +(ss?.win_count || 0), losses = +(ss?.loss_count || 0)
  const sp = prices[sym], instruments = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT']

  // ═══ RENDER — DENSE BLOOMBERG GRID ═══
  return (
    <div className="h-full flex flex-col">
      {/* TICKER STRIP */}
      <div className="flex items-center h-6 px-2 gap-3 flex-shrink-0 overflow-x-auto" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        {Object.entries(prices).map(([sym2, d]) => {
          const pct = d.change_pct_24h ?? 0
          return (
            <button key={sym2} onClick={() => setSym(sym2)} className="flex items-center gap-1 flex-shrink-0 text-[10px]" style={{ color: 'var(--text-1)' }}>
              <span className="font-bold" style={{ color: 'var(--text-2)' }}>{S[sym2] ?? sym2}</span>
              <span className="font-bold">{f(d.price)}</span>
              <span style={{ color: pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
            </button>
          )
        })}
      </div>

      {/* MAIN GRID — 12 columns, every pixel used */}
      <div className="flex-1 grid grid-cols-12 grid-rows-[1fr_auto] gap-px overflow-hidden" style={{ background: 'var(--border)' }}>

        {/* CHART — 8 cols */}
        <div className="col-span-12 lg:col-span-8 flex flex-col" style={{ background: 'var(--bg-1)' }}>
          <div className="flex items-center gap-0.5 px-1 py-0.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            {instruments.map(s2 => (
              <button key={s2} onClick={() => setSym(s2)} className="px-1.5 py-0.5 text-[9px] font-bold" style={{
                color: sym === s2 ? 'var(--amber)' : 'var(--text-3)',
                background: sym === s2 ? 'var(--bg-2)' : 'transparent',
              }}>{S[s2]}</button>
            ))}
            <div className="flex-1" />
            {sp && <span className="text-[10px] font-bold" style={{ color: (sp.change_pct_24h ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{f(sp.price)} {(sp.change_pct_24h ?? 0) >= 0 ? '+' : ''}{(sp.change_pct_24h ?? 0).toFixed(2)}% H:{f(sp.high_24h)} L:{f(sp.low_24h)}</span>}
          </div>
          <div className="flex-1 min-h-0"><Chart candles={candles} symbol={sym} /></div>
        </div>

        {/* RIGHT PANELS — 4 cols */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-px overflow-y-auto" style={{ background: 'var(--border)' }}>

          {/* PORTFOLIO */}
          <div className="p-2" style={{ background: 'var(--bg-1)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>PORTFOLIO</span>
              <span className="text-[11px] font-bold" style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(0)} AED</span>
            </div>
            <div className="text-[16px] font-black" style={{ color: 'var(--text-0)' }}>AED {(cap + pnl).toLocaleString()}</div>
            <div className="grid grid-cols-4 gap-1 mt-1">
              {[{ l: 'CAP', v: cap.toLocaleString() }, { l: 'W/L', v: `${wins}/${losses}` }, { l: 'WR', v: `${wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(0) : '—'}%` }, { l: 'DD', v: ss?.max_drawdown ? `${(+ss.max_drawdown * 100).toFixed(1)}%` : '—' }].map(x => (
                <div key={x.l} className="text-center p-1 rounded" style={{ background: 'var(--bg-2)' }}>
                  <div className="text-[7px]" style={{ color: 'var(--text-3)' }}>{x.l}</div>
                  <div className="text-[10px] font-bold" style={{ color: 'var(--text-0)' }}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* PROFIT ALLOCATION */}
          {profit && profit.totalProfit !== 0 && (
            <div className="p-2" style={{ background: 'var(--bg-1)' }}>
              <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>PROFIT ALLOCATION</span>
              <div className="flex gap-1 mt-1">
                {[
                  { l: 'REINVEST', v: `${profit.reinvestPct}%`, c: 'var(--blue)' },
                  { l: 'PAYOUT', v: `${profit.payoutPct}%`, c: 'var(--green)' },
                  { l: 'RESERVE', v: `${profit.reservePct}%`, c: 'var(--amber)' },
                ].map(x => (
                  <div key={x.l} className="flex-1 text-center p-1 rounded" style={{ background: 'var(--bg-2)' }}>
                    <div className="text-[7px]" style={{ color: 'var(--text-3)' }}>{x.l}</div>
                    <div className="text-[11px] font-bold" style={{ color: x.c }}>{x.v}</div>
                  </div>
                ))}
              </div>
              <div className="text-[8px] mt-1" style={{ color: 'var(--text-3)' }}>{profit.reason}</div>
            </div>
          )}

          {/* POSITIONS */}
          <div style={{ background: 'var(--bg-1)' }}>
            <div className="flex justify-between px-2 py-1" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>POSITIONS</span>
              <span className="text-[9px] font-bold" style={{ color: 'var(--blue)' }}>{openT.length}</span>
            </div>
            {openT.map((t: any, i: number) => {
              const dir = String(t.direction), entry = +t.entry_price, cur = +(t.current_price || entry)
              const lp = +(t.live_pnl_aed || 0), lpct = +(t.live_pnl_pct || 0), up = lp >= 0
              const sl = +t.stop_loss, tp = +t.take_profit
              const slD = cur > 0 ? (Math.abs(cur - sl) / cur * 100).toFixed(1) : '—'
              const tpD = cur > 0 ? (Math.abs(tp - cur) / cur * 100).toFixed(1) : '—'
              const opened = t.entry_time ? new Date(t.entry_time) : null
              const mins = opened ? Math.floor((Date.now() - opened.getTime()) / 60000) : 0
              return (
                <div key={i} className="px-2 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex justify-between">
                    <span><span style={{ color: dir === 'long' ? 'var(--green)' : 'var(--red)' }}>●</span> <span className="font-bold" style={{ color: 'var(--text-0)' }}>{S[t.instrument] ?? t.instrument}</span> <span className="text-[9px]" style={{ color: dir === 'long' ? 'var(--green)' : 'var(--red)' }}>{dir.toUpperCase()}</span></span>
                    <span className="font-bold" style={{ color: up ? 'var(--green)' : 'var(--red)' }}>{up ? '+' : ''}{lp.toFixed(0)} ({up ? '+' : ''}{lpct.toFixed(1)}%)</span>
                  </div>
                  <div className="text-[9px] grid grid-cols-3 gap-1 mt-0.5" style={{ color: 'var(--text-2)' }}>
                    <span>E:{f(entry)}</span>
                    <span>SL:<span style={{ color: 'var(--red)' }}>{slD}%</span></span>
                    <span>TP:<span style={{ color: 'var(--green)' }}>{tpD}%</span></span>
                  </div>
                  <div className="text-[8px]" style={{ color: 'var(--text-3)' }}>{Math.floor(mins / 60)}h{mins % 60}m | {String(t.signal_reason ?? '').split(' ').slice(0, 3).join(' ')}</div>
                </div>
              )
            })}
            {openT.length === 0 && <div className="p-2 text-[9px] text-center" style={{ color: 'var(--text-3)' }}>No positions — waiting</div>}
          </div>

          {/* SAFETY */}
          <div className="p-2" style={{ background: 'var(--bg-1)' }}>
            <div className="flex justify-between mb-1">
              <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>SAFETY</span>
              <span className="text-[8px] font-bold" style={{ color: safety?.safe ? 'var(--green)' : 'var(--red)' }}>{safety?.safe ? 'OK' : 'ALERT'}</span>
            </div>
            {[
              { l: 'DD', v: (+(safety?.drawdownPct ?? 0) * 100), m: 15 },
              { l: 'DAY', v: (+(safety?.dailyLossPct ?? 0) * 100), m: 3 },
              { l: 'POS', v: +(safety?.openPositions ?? 0), m: 3 },
            ].map(x => (
              <div key={x.l} className="flex items-center gap-1 mb-0.5">
                <span className="text-[8px] w-6" style={{ color: 'var(--text-3)' }}>{x.l}</span>
                <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--bg-3)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(x.v / x.m * 100, 100)}%`, background: x.v / x.m > 0.75 ? 'var(--red)' : x.v / x.m > 0.5 ? 'var(--amber)' : 'var(--green)' }} />
                </div>
                <span className="text-[8px] w-12 text-right" style={{ color: 'var(--text-2)' }}>{x.v.toFixed(1)}/{x.m}</span>
              </div>
            ))}
          </div>

          {/* SIGNALS (latest 3) */}
          <div style={{ background: 'var(--bg-1)' }}>
            <div className="flex justify-between px-2 py-1" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>LATEST SIGNALS</span>
              <a href="/signals" className="text-[8px]" style={{ color: 'var(--blue)' }}>ALL →</a>
            </div>
            {signals.slice(0, 3).map(s => (
              <div key={s.id} className="px-2 py-1" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex justify-between">
                  <span><span className="font-bold" style={{ color: 'var(--text-0)' }}>{s.instrument}</span> <span className="text-[9px]" style={{ color: s.direction === 'long' ? 'var(--green)' : 'var(--red)' }}>{s.direction.toUpperCase()}</span> <span className="text-[8px]" style={{ color: 'var(--blue)' }}>R:R {s.risk_reward}x</span></span>
                  <span className="font-bold" style={{ color: 'var(--text-0)' }}>{s.confidence}%</span>
                </div>
                <div className="text-[8px]" style={{ color: 'var(--text-3)' }}>{s.reasoning}</div>
              </div>
            ))}
          </div>

          {/* AGENT LOG (latest 5) */}
          <div style={{ background: 'var(--bg-1)' }}>
            <div className="flex justify-between px-2 py-1" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>AI ACTIVITY</span>
              <a href="/ai-log" className="text-[8px]" style={{ color: 'var(--blue)' }}>ALL →</a>
            </div>
            {agentLogs.slice(0, 5).map((l, i) => (
              <div key={i} className="flex gap-1 px-2 py-0.5 text-[8px]" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                <span style={{ color: l.level === 'ok' ? 'var(--green)' : l.level === 'warn' ? 'var(--amber)' : l.level === 'error' ? 'var(--red)' : 'var(--text-3)' }}>●</span>
                <span style={{ color: 'var(--text-3)' }}>{new Date(l.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="truncate">{l.message}</span>
              </div>
            ))}
          </div>
        </div>

        {/* BOTTOM ROW — Market prices grid */}
        <div className="col-span-12 flex items-center gap-0 overflow-x-auto" style={{ background: 'var(--bg-1)' }}>
          {Object.entries(prices).map(([sym2, d]) => {
            const pct = d.change_pct_24h ?? 0
            return (
              <button key={sym2} onClick={() => setSym(sym2)} className="flex-shrink-0 px-3 py-1 text-center" style={{ borderRight: '1px solid var(--border)', background: sym === sym2 ? 'var(--bg-2)' : 'transparent' }}>
                <div className="text-[8px] font-bold" style={{ color: 'var(--text-3)' }}>{S[sym2] ?? sym2}</div>
                <div className="text-[11px] font-bold" style={{ color: 'var(--text-0)' }}>{f(d.price)}</div>
                <div className="text-[9px] font-bold" style={{ color: pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function Page() { return <RealtimeProvider><Dashboard /></RealtimeProvider> }
