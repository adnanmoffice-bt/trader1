'use client'
import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { RealtimeProvider } from '@/components/providers/RealtimeProvider'
import { TradingChart, type Timeframe, type SignalMarker, type TradeMarker } from '@/components/charts/TradingChart'
import { TickerTape } from '@/components/widgets/TickerTape'
import { TechAnalysis } from '@/components/widgets/TechAnalysis'
import { PerformanceMetrics } from '@/components/analytics/PerformanceMetrics'
import type { OHLCV } from '@/types'

const S: Record<string, string> = { 'BTC/USD': 'BTC', 'ETH/USD': 'ETH', 'SOL/USD': 'SOL', 'BNB/USD': 'BNB', 'XAU/USD': 'GOLD', 'BRENT': 'OIL', 'SPY': 'SPY', 'QQQ': 'QQQ' }
const f = (n: number) => n >= 10000 ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n >= 100 ? n.toFixed(2) : n.toFixed(2)
const instruments = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT'] as const

type SidePanel = 'portfolio' | 'analysis' | 'signals' | 'performance'

function PerformancePanel() {
  const [perf, setPerf] = useState<any>(null)
  useEffect(() => {
    fetch('/api/analytics/performance').then(r => r.json()).then(d => setPerf(d.data)).catch(() => {})
  }, [])
  return <PerformanceMetrics data={perf} />
}

function Dashboard() {
  const { theme } = useTheme()
  const prices = useStore(s => s.prices)
  const signals = useStore(s => s.signals)
  const agentLogs = useStore(s => s.agentLogs)
  const [sym, setSym] = useState('BTC/USD')
  const [tf, setTf] = useState<Timeframe>('1h')
  const [candles, setCandles] = useState<OHLCV[]>([])
  const [demo, setDemo] = useState<{ session: any; trades: any[] }>({ session: null, trades: [] })
  const [safety, setSafety] = useState<any>(null)
  const [profit, setProfit] = useState<any>(null)
  const [sidePanel, setSidePanel] = useState<SidePanel>('portfolio')
  const ct = theme === 'dark' ? 'dark' as const : 'light' as const

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

  const fetchCandles = useCallback((s: string, t: Timeframe) => {
    const intervalMap: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1d', '1W': '1w' }
    fetch(`/api/prices?symbol=${encodeURIComponent(s)}&candles=true&interval=${intervalMap[t] || '1h'}&limit=200`)
      .then(r => r.json()).then(d => { if (d.data) setCandles(d.data) }).catch(() => {})
  }, [])

  useEffect(() => { fetchCandles(sym, tf) }, [sym, tf, fetchCandles])

  const handleTfChange = useCallback((newTf: Timeframe) => setTf(newTf), [])

  const ss = demo.session, openT = demo.trades.filter((t: any) => !t.exit_time), closedT = demo.trades.filter((t: any) => t.exit_time)
  const pnl = +(ss?.total_pnl || 0), cap = +(ss?.initial_capital || 5000), wins = +(ss?.win_count || 0), losses = +(ss?.loss_count || 0)
  const sp = prices[sym]

  // Build signal markers for chart
  const signalMarkers: SignalMarker[] = signals
    .filter(s => s.instrument === sym && s.created_at)
    .map(s => ({
      time: new Date(s.created_at).getTime(),
      direction: s.direction as 'long' | 'short',
      label: `${s.direction === 'long' ? 'LONG' : 'SHORT'} ${s.confidence}%`,
    }))

  // Build trade markers for chart
  const tradeMarkers: TradeMarker[] = demo.trades
    .filter((t: any) => t.instrument === sym)
    .flatMap((t: any) => {
      const markers: TradeMarker[] = []
      if (t.entry_time) markers.push({
        time: new Date(t.entry_time).getTime(),
        type: 'entry',
        direction: t.direction,
        price: +t.entry_price,
      })
      if (t.exit_time) markers.push({
        time: new Date(t.exit_time).getTime(),
        type: 'exit',
        direction: t.direction,
        price: +t.exit_price,
        pnl: +t.pnl || 0,
      })
      return markers
    })

  return (
    <div className="h-full flex flex-col">
      {/* TradingView Ticker Tape */}
      <TickerTape colorTheme={ct} />

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-12 gap-px overflow-hidden" style={{ background: 'var(--border)' }}>

        {/* LEFT: Instrument Selector + Chart (9 cols - chart dominant like TV) */}
        <div className="col-span-12 lg:col-span-9 flex flex-col min-h-0" style={{ background: 'var(--bg-1)' }}>
          {/* Instrument tabs + live stats */}
          <div className="flex items-center gap-0.5 px-2 py-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            {instruments.map(s2 => (
              <button key={s2} onClick={() => setSym(s2)} className="px-2 py-0.5 text-[10px] font-bold rounded transition-colors" style={{
                color: sym === s2 ? '#000' : 'var(--text-3)',
                background: sym === s2 ? 'var(--amber)' : 'transparent',
              }}>{S[s2]}</button>
            ))}
            <div className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />
            {sp && (
              <div className="flex items-center gap-3 ml-1">
                <span className="text-[14px] font-black" style={{ color: 'var(--text-0)' }}>{f(sp.price)}</span>
                <span className="text-[11px] font-bold" style={{ color: (sp.change_pct_24h ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {(sp.change_pct_24h ?? 0) >= 0 ? '+' : ''}{(sp.change_pct_24h ?? 0).toFixed(2)}%
                </span>
                <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>H: <span style={{ color: 'var(--text-2)' }}>{f(sp.high_24h)}</span></span>
                <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>L: <span style={{ color: 'var(--text-2)' }}>{f(sp.low_24h)}</span></span>
                <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>Vol: <span style={{ color: 'var(--text-2)' }}>{(sp.volume_24h / 1e6).toFixed(1)}M</span></span>
              </div>
            )}
          </div>

          {/* TradingView-style Chart */}
          <div className="flex-1 min-h-0">
            <TradingChart
              candles={candles}
              symbol={sym}
              timeframe={tf}
              onTimeframeChange={handleTfChange}
              signals={signalMarkers}
              trades={tradeMarkers}
              showVolume={true}
              showEMA={true}
              showBB={false}
              showSMA={false}
              showRSI={false}
              showMACD={false}
            />
          </div>
        </div>

        {/* RIGHT SIDEBAR (3 cols) */}
        <div className="col-span-12 lg:col-span-3 flex flex-col min-h-0 overflow-hidden" style={{ background: 'var(--bg-1)' }}>
          {/* Side panel tabs */}
          <div className="flex items-center flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            {([
              { key: 'portfolio' as const, label: 'PORTFOLIO' },
              { key: 'performance' as const, label: 'PERF' },
              { key: 'analysis' as const, label: 'ANALYSIS' },
              { key: 'signals' as const, label: 'SIGNALS' },
            ]).map(tab => (
              <button key={tab.key} onClick={() => setSidePanel(tab.key)}
                className="flex-1 py-1.5 text-[9px] font-bold text-center transition-colors"
                style={{
                  color: sidePanel === tab.key ? 'var(--amber)' : 'var(--text-3)',
                  background: sidePanel === tab.key ? 'var(--bg-2)' : 'transparent',
                  borderBottom: sidePanel === tab.key ? '2px solid var(--amber)' : '2px solid transparent',
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Side panel content */}
          <div className="flex-1 overflow-y-auto">

            {/* PORTFOLIO panel */}
            {sidePanel === 'portfolio' && (
              <div className="flex flex-col gap-px" style={{ background: 'var(--border)' }}>
                {/* Portfolio summary */}
                <div className="p-3" style={{ background: 'var(--bg-1)' }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>EQUITY</span>
                    <span className="text-[10px] font-bold" style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}</span>
                  </div>
                  <div className="text-[20px] font-black" style={{ color: 'var(--text-0)' }}>${(cap + pnl).toLocaleString()}</div>
                  <div className="grid grid-cols-4 gap-1 mt-2">
                    {[
                      { l: 'CAPITAL', v: `$${cap.toLocaleString()}`, c: 'var(--text-0)' },
                      { l: 'W/L', v: `${wins}/${losses}`, c: 'var(--text-0)' },
                      { l: 'WIN RATE', v: `${wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(0) : '—'}%`, c: wins / (wins + losses || 1) > 0.5 ? 'var(--green)' : 'var(--red)' },
                      { l: 'MAX DD', v: ss?.max_drawdown ? `${(+ss.max_drawdown * 100).toFixed(1)}%` : '—', c: 'var(--red)' },
                    ].map(x => (
                      <div key={x.l} className="text-center p-1.5 rounded" style={{ background: 'var(--bg-2)' }}>
                        <div className="text-[7px]" style={{ color: 'var(--text-3)' }}>{x.l}</div>
                        <div className="text-[10px] font-bold" style={{ color: x.c }}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Profit allocation */}
                {profit && profit.totalProfit !== 0 && (
                  <div className="p-3" style={{ background: 'var(--bg-1)' }}>
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>PROFIT ALLOCATION</span>
                    <div className="flex gap-1 mt-1.5">
                      {[
                        { l: 'REINVEST', v: `${profit.reinvestPct}%`, c: 'var(--blue)' },
                        { l: 'PAYOUT', v: `${profit.payoutPct}%`, c: 'var(--green)' },
                        { l: 'RESERVE', v: `${profit.reservePct}%`, c: 'var(--amber)' },
                      ].map(x => (
                        <div key={x.l} className="flex-1 text-center p-1.5 rounded" style={{ background: 'var(--bg-2)' }}>
                          <div className="text-[7px]" style={{ color: 'var(--text-3)' }}>{x.l}</div>
                          <div className="text-[11px] font-bold" style={{ color: x.c }}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Open Positions */}
                <div style={{ background: 'var(--bg-1)' }}>
                  <div className="flex justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>OPEN POSITIONS</span>
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
                      <div key={i} className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                        <div className="flex justify-between items-center">
                          <span>
                            <span style={{ color: dir === 'long' ? 'var(--green)' : 'var(--red)' }}>●</span>
                            {' '}<span className="font-bold text-[11px]" style={{ color: 'var(--text-0)' }}>{S[t.instrument] ?? t.instrument}</span>
                            {' '}<span className="text-[9px] font-bold" style={{ color: dir === 'long' ? 'var(--green)' : 'var(--red)' }}>{dir.toUpperCase()}</span>
                          </span>
                          <span className="text-[11px] font-bold" style={{ color: up ? 'var(--green)' : 'var(--red)' }}>
                            {up ? '+' : ''}{lp.toFixed(0)} ({up ? '+' : ''}{lpct.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="text-[9px] grid grid-cols-3 gap-1 mt-1" style={{ color: 'var(--text-2)' }}>
                          <span>E: {f(entry)}</span>
                          <span>SL: <span style={{ color: 'var(--red)' }}>{slD}%</span></span>
                          <span>TP: <span style={{ color: 'var(--green)' }}>{tpD}%</span></span>
                        </div>
                        <div className="text-[8px] mt-0.5" style={{ color: 'var(--text-3)' }}>{Math.floor(mins / 60)}h{mins % 60}m | {String(t.signal_reason ?? '').split(' ').slice(0, 4).join(' ')}</div>
                      </div>
                    )
                  })}
                  {openT.length === 0 && <div className="p-3 text-[9px] text-center" style={{ color: 'var(--text-3)' }}>No open positions</div>}
                </div>

                {/* Safety */}
                <div className="p-3" style={{ background: 'var(--bg-1)' }}>
                  <div className="flex justify-between mb-2">
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>RISK MONITOR</span>
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{
                      color: safety?.safe ? '#000' : '#fff',
                      background: safety?.safe ? 'var(--green)' : 'var(--red)',
                    }}>{safety?.safe ? 'SAFE' : 'ALERT'}</span>
                  </div>
                  {[
                    { l: 'DRAWDOWN', v: (+(safety?.drawdownPct ?? 0) * 100), m: 15 },
                    { l: 'DAILY LOSS', v: (+(safety?.dailyLossPct ?? 0) * 100), m: 3 },
                    { l: 'POSITIONS', v: +(safety?.openPositions ?? 0), m: 3 },
                  ].map(x => (
                    <div key={x.l} className="flex items-center gap-2 mb-1">
                      <span className="text-[8px] w-14" style={{ color: 'var(--text-3)' }}>{x.l}</span>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-3)' }}>
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${Math.min(x.v / x.m * 100, 100)}%`,
                          background: x.v / x.m > 0.75 ? 'var(--red)' : x.v / x.m > 0.5 ? 'var(--amber)' : 'var(--green)',
                        }} />
                      </div>
                      <span className="text-[8px] w-10 text-right font-bold" style={{ color: 'var(--text-2)' }}>{x.v.toFixed(1)}/{x.m}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PERFORMANCE panel */}
            {sidePanel === 'performance' && (
              <div className="flex flex-col gap-px" style={{ background: 'var(--border)' }}>
                <div style={{ background: 'var(--bg-1)' }}>
                  <div className="flex justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>PERFORMANCE METRICS</span>
                    <a href="/analytics" className="text-[8px] font-bold" style={{ color: 'var(--blue)' }}>FULL ANALYTICS →</a>
                  </div>
                  <PerformancePanel />
                </div>
              </div>
            )}

            {/* ANALYSIS panel (TradingView Technical Analysis widget) */}
            {sidePanel === 'analysis' && (
              <div style={{ background: 'var(--bg-1)' }}>
                <TechAnalysis symbol={sym} colorTheme={ct} height={400} />
              </div>
            )}

            {/* SIGNALS panel */}
            {sidePanel === 'signals' && (
              <div className="flex flex-col gap-px" style={{ background: 'var(--border)' }}>
                {/* Latest Signals */}
                <div style={{ background: 'var(--bg-1)' }}>
                  <div className="flex justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>LATEST SIGNALS</span>
                    <a href="/signals" className="text-[8px] font-bold" style={{ color: 'var(--blue)' }}>VIEW ALL →</a>
                  </div>
                  {signals.slice(0, 5).map(s => (
                    <div key={s.id} className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div className="flex justify-between items-center">
                        <span>
                          <span className="font-bold text-[11px]" style={{ color: 'var(--text-0)' }}>{s.instrument}</span>
                          {' '}<span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{
                            color: '#000',
                            background: s.direction === 'long' ? 'var(--green)' : 'var(--red)',
                          }}>{s.direction.toUpperCase()}</span>
                        </span>
                        <div className="text-right">
                          <span className="text-[11px] font-bold" style={{ color: 'var(--text-0)' }}>{s.confidence}%</span>
                          <span className="text-[8px] ml-1" style={{ color: 'var(--blue)' }}>R:R {s.risk_reward}x</span>
                        </div>
                      </div>
                      <div className="text-[8px] mt-1" style={{ color: 'var(--text-3)' }}>{s.reasoning}</div>
                      <div className="text-[7px] mt-0.5" style={{ color: 'var(--text-3)' }}>{new Date(s.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  ))}
                  {signals.length === 0 && <div className="p-3 text-[9px] text-center" style={{ color: 'var(--text-3)' }}>No signals yet</div>}
                </div>

                {/* AI Activity */}
                <div style={{ background: 'var(--bg-1)' }}>
                  <div className="flex justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>AI ACTIVITY</span>
                    <a href="/ai-log" className="text-[8px] font-bold" style={{ color: 'var(--blue)' }}>VIEW ALL →</a>
                  </div>
                  {agentLogs.slice(0, 8).map((l, i) => (
                    <div key={i} className="flex gap-1.5 px-3 py-1 text-[8px]" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                      <span style={{
                        color: l.level === 'ok' ? 'var(--green)' : l.level === 'warn' ? 'var(--amber)' : l.level === 'error' ? 'var(--red)' : 'var(--text-3)',
                      }}>●</span>
                      <span className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>{new Date(l.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="truncate">{l.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Page() { return <RealtimeProvider><Dashboard /></RealtimeProvider> }
