'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { RealtimeProvider } from '@/components/providers/RealtimeProvider'
import type { Signal, MarketData, OHLCV } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function fmt(n: number | null | undefined, prefix = '$'): string {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 10000) return `${prefix}${n.toLocaleString('en', { maximumFractionDigits: 0 })}`
  if (Math.abs(n) >= 100) return `${prefix}${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `${prefix}${n.toFixed(2)}`
}
function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }
function pctColor(n: number) { return n >= 0 ? 'text-[#00ffa3]' : 'text-[#ff3366]' }
function bgPct(n: number) { return n >= 0 ? 'bg-[rgba(0,255,163,0.08)]' : 'bg-[rgba(255,51,102,0.08)]' }
const SYM_LABELS: Record<string, string> = {
  'BTC/USD': 'BTC', 'ETH/USD': 'ETH', 'SOL/USD': 'SOL', 'BNB/USD': 'BNB',
  'BRENT': 'BRENT', 'XAU/USD': 'GOLD', 'SPY': 'SPY', 'QQQ': 'QQQ',
  'EUR/USD': 'EUR', 'USD/JPY': 'JPY', 'XAG/USD': 'SILVER', 'WTI': 'WTI',
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANDLESTICK CHART (SVG)
// ═══════════════════════════════════════════════════════════════════════════════

function CandlestickChart({ candles, symbol }: { candles: OHLCV[]; symbol: string }) {
  const W = 960, H = 360
  const VOL_H = 50, PAD_R = 70, PAD_T = 8, PAD_B = 20
  const CHART_H = H - VOL_H - PAD_B - PAD_T
  const chartW = W - PAD_R

  if (!candles.length) return (
    <div className="flex items-center justify-center h-full text-[#44446a] text-xs">Ucitavam chart...</div>
  )

  const data = candles.slice(-100)
  const highs = data.map(c => c.high)
  const lows = data.map(c => c.low)
  const vols = data.map(c => c.volume)
  const pMin = Math.min(...lows) * 0.999
  const pMax = Math.max(...highs) * 1.001
  const vMax = Math.max(...vols) || 1

  const gap = chartW / data.length
  const cw = Math.max(1, gap * 0.65)
  const yP = (p: number) => PAD_T + (1 - (p - pMin) / (pMax - pMin)) * CHART_H
  const yV = (v: number) => H - PAD_B - (v / vMax) * VOL_H

  // Price grid lines
  const priceStep = (pMax - pMin) / 5
  const gridLines = Array.from({ length: 6 }, (_, i) => pMin + priceStep * i)

  // EMA-20 line
  const closes = data.map(c => c.close)
  const ema20: number[] = [closes[0]]
  const k = 2 / 21
  for (let i = 1; i < closes.length; i++) ema20.push(closes[i] * k + ema20[i - 1] * (1 - k))
  const emaPath = ema20.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * gap + gap / 2},${yP(v)}`).join(' ')

  const lastPrice = data[data.length - 1]?.close ?? 0
  const lastY = yP(lastPrice)

  return (
    <div className="w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
        {/* Grid */}
        {gridLines.map((p, i) => (
          <g key={i}>
            <line x1={0} y1={yP(p)} x2={chartW} y2={yP(p)} stroke="#1a1a2e" strokeWidth={0.5} />
            <text x={chartW + 4} y={yP(p) + 3} fill="#44446a" fontSize={9} fontFamily="monospace">{p >= 1000 ? p.toFixed(0) : p.toFixed(2)}</text>
          </g>
        ))}

        {/* Volume bars */}
        {data.map((d, i) => {
          const isUp = d.close >= d.open
          return (
            <rect key={`v${i}`} x={i * gap + (gap - cw) / 2} y={yV(d.volume)} width={cw}
              height={H - PAD_B - yV(d.volume)} fill={isUp ? 'rgba(0,255,163,0.12)' : 'rgba(255,51,102,0.12)'} />
          )
        })}

        {/* EMA-20 line */}
        <path d={emaPath} fill="none" stroke="#9966ff" strokeWidth={1} opacity={0.6} />

        {/* Candlesticks */}
        {data.map((d, i) => {
          const x = i * gap + gap / 2
          const isUp = d.close >= d.open
          const color = isUp ? '#00ffa3' : '#ff3366'
          const bodyTop = yP(Math.max(d.open, d.close))
          const bodyBot = yP(Math.min(d.open, d.close))
          const bodyH = Math.max(bodyBot - bodyTop, 0.5)
          return (
            <g key={`c${i}`}>
              <line x1={x} y1={yP(d.high)} x2={x} y2={yP(d.low)} stroke={color} strokeWidth={0.8} />
              <rect x={x - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={isUp ? color : color} rx={0.5} />
            </g>
          )
        })}

        {/* Current price line */}
        <line x1={0} y1={lastY} x2={chartW} y2={lastY} stroke="#00ccff" strokeWidth={0.5} strokeDasharray="3 2" />
        <rect x={chartW} y={lastY - 8} width={PAD_R - 2} height={16} rx={2} fill="#00ccff" />
        <text x={chartW + 4} y={lastY + 4} fill="#03030a" fontSize={9} fontWeight="bold" fontFamily="monospace">
          {lastPrice >= 1000 ? lastPrice.toFixed(0) : lastPrice.toFixed(2)}
        </text>

        {/* Symbol label */}
        <text x={8} y={20} fill="#44446a" fontSize={11} fontWeight="bold" fontFamily="monospace" letterSpacing={1}>
          {symbol} 1H
        </text>
        <text x={8} y={34} fill="#7878aa" fontSize={9} fontFamily="monospace">
          EMA20
        </text>
        <line x1={42} y1={31} x2={65} y2={31} stroke="#9966ff" strokeWidth={1} />
      </svg>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════

function Panel({ title, icon, badge, children, className = '' }: {
  title: string; icon?: string; badge?: string | number; children: React.ReactNode; className?: string
}) {
  return (
    <div className={cn('flex flex-col bg-[#07070f] border border-[#1a1a2e] overflow-hidden', className)}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0a0a16] border-b border-[#1a1a2e] flex-shrink-0">
        <div className="flex items-center gap-2">
          {icon && <span className="text-[9px]">{icon}</span>}
          <span className="text-[9px] font-bold tracking-[0.15em] text-[#44446a] uppercase">{title}</span>
        </div>
        {badge !== undefined && (
          <span className="text-[8px] font-bold text-[#7878aa] bg-[#141428] px-1.5 py-0.5 rounded">{badge}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET DATA TABLE
// ═══════════════════════════════════════════════════════════════════════════════

function MarketTable({ prices, selected, onSelect }: {
  prices: Record<string, MarketData>; selected: string; onSelect: (s: string) => void
}) {
  const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT', 'SPY', 'QQQ', 'EUR/USD', 'USD/JPY']
  return (
    <div className="text-[10px]">
      <div className="grid grid-cols-[1fr_80px_60px] gap-0 px-2 py-1 text-[8px] text-[#44446a] tracking-wider border-b border-[#1a1a2e]">
        <span>SYMBOL</span><span className="text-right">CIJENA</span><span className="text-right">24H</span>
      </div>
      {symbols.map(sym => {
        const d = prices[sym]
        if (!d) return null
        const pct = d.change_pct_24h ?? 0
        const up = pct >= 0
        return (
          <div key={sym} onClick={() => onSelect(sym)}
            className={cn(
              'grid grid-cols-[1fr_80px_60px] gap-0 px-2 py-[5px] cursor-pointer transition-colors border-b border-[#0f0f1e]',
              selected === sym ? 'bg-[rgba(0,204,255,0.06)] border-l-2 border-l-[#00ccff]' : 'hover:bg-[#0f0f1e] border-l-2 border-l-transparent'
            )}>
            <span className="font-bold text-[#e2e2f5]">{SYM_LABELS[sym] ?? sym}</span>
            <span className="text-right mono font-bold text-[#e2e2f5]">
              {d.price >= 1000 ? d.price.toLocaleString('en', { maximumFractionDigits: 0 }) : d.price.toFixed(2)}
            </span>
            <span className={cn('text-right font-bold mono', pctColor(pct))}>
              {up ? '+' : ''}{pct.toFixed(2)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNALS LIST
// ═══════════════════════════════════════════════════════════════════════════════

function SignalsList({ signals }: { signals: Signal[] }) {
  return (
    <div>
      {signals.slice(0, 8).map(s => {
        const isL = s.direction === 'long'
        const isS = s.direction === 'short'
        return (
          <div key={s.id} className="px-2 py-2 border-b border-[#0f0f1e] hover:bg-[#0f0f1e] transition-colors">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[10px] text-[#e2e2f5]">{s.instrument}</span>
                <span className={cn('text-[8px] font-black px-1.5 py-0.5 rounded',
                  isL && 'bg-[rgba(0,255,163,0.15)] text-[#00ffa3]',
                  isS && 'bg-[rgba(255,51,102,0.15)] text-[#ff3366]',
                  !isL && !isS && 'bg-[rgba(255,204,0,0.1)] text-[#ffcc00]'
                )}>{s.direction.toUpperCase()}</span>
                <span className="text-[8px] text-[#4d88ff] font-bold">R:R {s.risk_reward ?? '—'}x</span>
              </div>
              <span className="text-[8px] font-bold text-[#7878aa]">{s.confidence}%</span>
            </div>
            <div className="flex gap-3 text-[9px] mono text-[#7878aa]">
              <span>E: <span className="text-[#e2e2f5]">{fmt(s.entry_price)}</span></span>
              <span>SL: <span className="text-[#ff3366]">{fmt(s.stop_loss)}</span></span>
              <span>TP: <span className="text-[#00ffa3]">{fmt(s.take_profit_1)}</span></span>
            </div>
            <div className="text-[8px] text-[#44446a] mt-1 leading-snug">{s.reasoning}</div>
          </div>
        )
      })}
      {signals.length === 0 && (
        <div className="text-center py-6 text-[#44446a] text-[10px]">Cekam signale...</div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO / SIMULATION PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function DemoPanel({ demoData }: { demoData: { session: Record<string, unknown> | null; trades: Array<Record<string, unknown>> } }) {
  const s = demoData.session
  if (!s) return <div className="text-center py-4 text-[#44446a] text-[10px]">Nema demo sesije</div>

  const openTrades = demoData.trades.filter(t => !t.exit_time)
  const closedTrades = demoData.trades.filter(t => t.exit_time)
  const pnl = Number(s.total_pnl || 0)
  const pnlPct = Number(s.total_pnl_pct || 0)
  const wins = Number(s.win_count || 0)
  const losses = Number(s.loss_count || 0)
  const wr = wins + losses > 0 ? (wins / (wins + losses) * 100) : 0

  return (
    <div className="text-[10px]">
      {/* Stats bar */}
      <div className="flex gap-0 border-b border-[#1a1a2e]">
        {[
          { l: 'KAPITAL', v: `AED ${Number(s.initial_capital || 0).toLocaleString()}` },
          { l: 'P&L', v: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}`, cls: pctColor(pnl) },
          { l: '%', v: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, cls: pctColor(pnlPct) },
          { l: 'W/L', v: `${wins}/${losses}` },
          { l: 'WR', v: `${wr.toFixed(0)}%` },
        ].map(st => (
          <div key={st.l} className="flex-1 px-2 py-1.5 border-r border-[#1a1a2e] last:border-r-0">
            <div className="text-[7px] text-[#44446a] tracking-wider">{st.l}</div>
            <div className={cn('font-bold mono text-[11px]', st.cls || 'text-[#e2e2f5]')}>{st.v}</div>
          </div>
        ))}
      </div>

      {/* Open trades */}
      {openTrades.map((t, i) => {
        const dir = String(t.direction)
        const livePnl = Number(t.live_pnl_aed || 0)
        const livePct = Number(t.live_pnl_pct || 0)
        return (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5 border-b border-[#0f0f1e] hover:bg-[#0f0f1e]">
            <span className={cn('w-1 h-1 rounded-full', dir === 'long' ? 'bg-[#00ffa3]' : 'bg-[#ff3366]')} />
            <span className="font-bold text-[#e2e2f5] w-16">{SYM_LABELS[String(t.instrument)] ?? t.instrument}</span>
            <span className={cn('text-[8px] font-black', dir === 'long' ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>{dir.toUpperCase()}</span>
            <span className="mono text-[#7878aa] flex-1">@ {fmt(Number(t.entry_price))}</span>
            <span className={cn('mono font-bold', pctColor(livePnl))}>
              {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(0)} AED
            </span>
            <span className={cn('mono text-[9px]', pctColor(livePct))}>
              {livePct >= 0 ? '+' : ''}{livePct.toFixed(2)}%
            </span>
          </div>
        )
      })}

      {/* Closed trades (last 5) */}
      {closedTrades.slice(0, 5).map((t, i) => {
        const pnlA = Number(t.pnl_aed || 0)
        const isWin = pnlA > 0
        return (
          <div key={`c${i}`} className="flex items-center gap-2 px-2 py-1 border-b border-[#0f0f1e] opacity-60">
            <span className={cn('w-1 h-1 rounded-full', isWin ? 'bg-[#00ffa3]' : 'bg-[#ff3366]')} />
            <span className="text-[#7878aa] w-16">{SYM_LABELS[String(t.instrument)] ?? t.instrument}</span>
            <span className="text-[8px] text-[#44446a]">{String(t.exit_reason) === 'take_profit' ? 'TP' : 'SL'}</span>
            <span className="flex-1" />
            <span className={cn('mono font-bold', pctColor(pnlA))}>
              {isWin ? '+' : ''}{pnlA.toFixed(0)}
            </span>
          </div>
        )
      })}

      {openTrades.length === 0 && closedTrades.length === 0 && (
        <div className="text-center py-4 text-[#44446a] text-[9px]">Bot skenira svakih 15min...</div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT LOG
// ═══════════════════════════════════════════════════════════════════════════════

function AgentLog({ logs }: { logs: Array<Record<string, unknown>> }) {
  const dotColor: Record<string, string> = { ok: 'bg-[#00ffa3]', warn: 'bg-[#ffcc00]', error: 'bg-[#ff3366]', info: 'bg-[#44446a]' }
  const tagColor: Record<string, string> = {
    'orchestrator': 'text-[#9966ff]', 'market-analyst': 'text-[#4d88ff]',
    'risk-manager': 'text-[#ffcc00]', 'polymarket-scanner': 'text-[#00ccff]',
    'trade-reviewer': 'text-[#00ccff]',
  }
  return (
    <div>
      {logs.slice(0, 30).map((log, i) => (
        <div key={i} className="flex items-start gap-1.5 px-2 py-1 border-b border-[#0f0f1e] hover:bg-[#0f0f1e]">
          <div className={cn('w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0', dotColor[String(log.level)] ?? 'bg-[#44446a]')} />
          <span className="text-[8px] text-[#44446a] mono w-10 flex-shrink-0">
            {log.created_at ? new Date(String(log.created_at)).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
          <span className={cn('text-[8px] font-bold flex-shrink-0 w-6', tagColor[String(log.agent)] ?? 'text-[#44446a]')}>
            {String(log.agent ?? '').split('-').map((w: string) => w[0]?.toUpperCase() ?? '').join('')}
          </span>
          <span className="text-[9px] text-[#7878aa] leading-tight">{String(log.message ?? '').slice(0, 100)}</span>
        </div>
      ))}
      {logs.length === 0 && <div className="text-center py-4 text-[#44446a] text-[9px]">Cekam agent aktivnost...</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLYMARKET COMPACT
// ═══════════════════════════════════════════════════════════════════════════════

function PolyCompact({ bets, markets }: { bets: Array<Record<string, unknown>>; markets: Array<Record<string, unknown>> }) {
  return (
    <div>
      {bets.length > 0 && bets.slice(0, 3).map((b, i) => (
        <div key={i} className="px-2 py-1.5 border-b border-[#0f0f1e]">
          <div className="flex items-center gap-1.5">
            <span className={cn('text-[8px] font-black px-1 rounded',
              String(b.side) === 'YES' ? 'bg-[rgba(0,255,163,0.15)] text-[#00ffa3]' : 'bg-[rgba(255,51,102,0.15)] text-[#ff3366]'
            )}>{String(b.side)}</span>
            <span className="text-[9px] text-[#e2e2f5] leading-tight truncate">{String(b.question).slice(0, 60)}</span>
          </div>
        </div>
      ))}
      {markets.slice(0, 6).map((m, i) => (
        <div key={i} className="flex items-center justify-between px-2 py-1 border-b border-[#0f0f1e] hover:bg-[#0f0f1e]">
          <span className="text-[9px] text-[#7878aa] truncate flex-1 pr-2">{String(m.question).slice(0, 55)}</span>
          <span className={cn('text-[10px] font-bold mono flex-shrink-0',
            Number(m.yes_price) > 0.6 ? 'text-[#00ffa3]' : Number(m.yes_price) < 0.4 ? 'text-[#ff3366]' : 'text-[#ffcc00]'
          )}>{(Number(m.yes_price) * 100).toFixed(0)}%</span>
        </div>
      ))}
      {markets.length === 0 && bets.length === 0 && (
        <div className="text-center py-4 text-[#44446a] text-[9px]">Ucitavam prediction markets...</div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TERMINAL
// ═══════════════════════════════════════════════════════════════════════════════

function Terminal() {
  const prices = useStore(s => s.prices)
  const signals = useStore(s => s.signals)
  const agentLogs = useStore(s => s.agentLogs)
  const fearGreedIndex = useStore(s => s.fearGreedIndex)
  const [clock, setClock] = useState('')
  const [selectedSym, setSelectedSym] = useState('BTC/USD')
  const [candles, setCandles] = useState<OHLCV[]>([])
  const [polyBets, setPolyBets] = useState<Array<Record<string, unknown>>>([])
  const [polyMarkets, setPolyMarkets] = useState<Array<Record<string, unknown>>>([])
  const [demoData, setDemoData] = useState<{ session: Record<string, unknown> | null; trades: Array<Record<string, unknown>> }>({ session: null, trades: [] })
  const [fng, setFng] = useState(50)

  // Clock
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Initial data fetch
  useEffect(() => {
    const store = useStore.getState()
    fetch('/api/prices').then(r => r.json()).then(d => {
      if (d.data && Array.isArray(d.data)) {
        const parsed = d.data.map((item: Record<string, unknown>) => ({
          ...item,
          price: Number(item.price) || 0, change_24h: Number(item.change_24h) || 0,
          change_pct_24h: Number(item.change_pct_24h) || 0, volume_24h: Number(item.volume_24h) || 0,
          high_24h: Number(item.high_24h) || 0, low_24h: Number(item.low_24h) || 0,
          open_24h: Number(item.open_24h) || 0, market_cap: item.market_cap ? Number(item.market_cap) : null,
        }))
        store.setPrices(parsed)
      }
    }).catch(() => {})
    fetch('/api/signals').then(r => r.json()).then(d => { if (d.data) store.setSignals(d.data) }).catch(() => {})
    fetch('/api/agent-logs').then(r => r.json()).then(d => {
      if (d.data) d.data.forEach((log: import('@/types').AgentLog) => store.addAgentLog(log))
    }).catch(() => {})
    fetch('/api/polymarket/bets').then(r => r.json()).then(d => { if (d.data) setPolyBets(d.data) }).catch(() => {})
    fetch('/api/polymarket/markets').then(r => r.json()).then(d => { if (d.data) setPolyMarkets(d.data) }).catch(() => {})
    fetch('/api/demo').then(r => r.json()).then(d => {
      if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] })
    }).catch(() => {})
  }, [])

  // Fetch candles when symbol changes
  const fetchCandles = useCallback((sym: string) => {
    fetch(`/api/prices?symbol=${encodeURIComponent(sym)}&candles=true&interval=1h&limit=100`)
      .then(r => r.json())
      .then(d => { if (d.data) setCandles(d.data) })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchCandles(selectedSym) }, [selectedSym, fetchCandles])

  // Auto-refresh demo data every 30s
  useEffect(() => {
    const t = setInterval(() => {
      fetch('/api/demo').then(r => r.json()).then(d => {
        if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] })
      }).catch(() => {})
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const selectedPrice = prices[selectedSym]
  const tickerSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT', 'SPY']

  // Demo stats for header
  const demoPnl = Number(demoData.session?.total_pnl || 0)
  const demoOpenCount = demoData.trades.filter(t => !t.exit_time).length

  const fgColor = fearGreedIndex > 60 ? 'text-[#00ffa3]' : fearGreedIndex < 40 ? 'text-[#ff3366]' : 'text-[#ffcc00]'
  const fgLabel = fearGreedIndex > 75 ? 'GREED' : fearGreedIndex > 55 ? 'NEUTRAL' : fearGreedIndex > 25 ? 'FEAR' : 'EXTREME FEAR'

  return (
    <div className="flex flex-col h-screen bg-[#03030a] text-[#e2e2f5] select-none">

      {/* ═══ TOP BAR ═══ */}
      <header className="flex items-center h-10 bg-[#07070f] border-b border-[#1a1a2e] flex-shrink-0 px-3 gap-4">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-black tracking-tight">APEX</span>
          <span className="flex items-center gap-1 text-[8px] font-bold text-[#00ffa3] tracking-[0.15em] px-1.5 py-0.5 border border-[rgba(0,255,163,0.2)] rounded bg-[rgba(0,255,163,0.05)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ffa3] animate-pulse" />LIVE
          </span>
        </div>

        {/* Ticker strip */}
        <div className="flex items-center gap-4 flex-1 overflow-hidden">
          {tickerSymbols.map(sym => {
            const d = prices[sym]
            if (!d) return null
            const pct = d.change_pct_24h ?? 0
            return (
              <button key={sym} onClick={() => setSelectedSym(sym)}
                className={cn('flex items-center gap-1.5 text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded transition-colors',
                  selectedSym === sym ? 'bg-[rgba(0,204,255,0.08)]' : 'hover:bg-[#0f0f1e]'
                )}>
                <span className="font-bold text-[#7878aa]">{SYM_LABELS[sym]}</span>
                <span className="mono font-bold text-[#e2e2f5]">{d.price >= 1000 ? d.price.toLocaleString('en', { maximumFractionDigits: 0 }) : d.price.toFixed(2)}</span>
                <span className={cn('mono font-bold', pctColor(pct))}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </button>
            )
          })}
        </div>

        {/* Right stats */}
        <div className="flex items-center gap-4 flex-shrink-0 text-[10px]">
          <div className="text-right">
            <div className="text-[7px] text-[#44446a]">DEMO P&L</div>
            <div className={cn('font-bold mono', pctColor(demoPnl))}>{demoPnl >= 0 ? '+' : ''}{demoPnl.toFixed(0)} AED</div>
          </div>
          <div className="text-right">
            <div className="text-[7px] text-[#44446a]">OPEN</div>
            <div className="font-bold mono text-[#00ccff]">{demoOpenCount}</div>
          </div>
          <div className="text-right">
            <div className="text-[7px] text-[#44446a]">F&G</div>
            <div className={cn('font-bold mono', fgColor)}>{fearGreedIndex}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[7px] text-[#44446a]">ABU DHABI</div>
            <div className="font-bold mono text-[#00ccff]">{clock}</div>
          </div>
        </div>
      </header>

      {/* ═══ INSTRUMENT TABS ═══ */}
      <div className="flex items-center h-7 bg-[#0a0a16] border-b border-[#1a1a2e] flex-shrink-0 px-2 gap-0.5">
        {['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT'].map(sym => (
          <button key={sym} onClick={() => setSelectedSym(sym)}
            className={cn('px-3 py-1 text-[9px] font-bold rounded-sm transition-colors',
              selectedSym === sym
                ? 'bg-[rgba(0,204,255,0.1)] text-[#00ccff] border-b border-[#00ccff]'
                : 'text-[#44446a] hover:text-[#7878aa] hover:bg-[#0f0f1e]'
            )}>
            {SYM_LABELS[sym] ?? sym}
          </button>
        ))}
        <div className="flex-1" />
        {selectedPrice && (
          <div className="flex items-center gap-3 text-[10px]">
            <span className="mono font-bold">{fmt(selectedPrice.price)}</span>
            <span className={cn('mono font-bold', pctColor(selectedPrice.change_pct_24h ?? 0))}>
              {(selectedPrice.change_pct_24h ?? 0) >= 0 ? '+' : ''}{(selectedPrice.change_pct_24h ?? 0).toFixed(2)}%
            </span>
            <span className="text-[#44446a]">H: <span className="text-[#7878aa] mono">{fmt(selectedPrice.high_24h)}</span></span>
            <span className="text-[#44446a]">L: <span className="text-[#7878aa] mono">{fmt(selectedPrice.low_24h)}</span></span>
            <span className="text-[#44446a]">Vol: <span className="text-[#7878aa] mono">{selectedPrice.volume_24h >= 1e6 ? `$${(selectedPrice.volume_24h / 1e6).toFixed(1)}M` : `$${selectedPrice.volume_24h.toLocaleString()}`}</span></span>
          </div>
        )}
      </div>

      {/* ═══ MAIN GRID ═══ */}
      <div className="flex-1 flex flex-col xl:grid xl:grid-cols-[1fr_340px] xl:grid-rows-[1fr_280px] gap-px bg-[#1a1a2e]/50 overflow-auto xl:overflow-hidden min-h-0">

        {/* CHART PANEL */}
        <div className="bg-[#07070f] overflow-hidden min-h-[300px] xl:min-h-0">
          <CandlestickChart candles={candles} symbol={selectedSym} />
        </div>

        {/* RIGHT SIDEBAR: Market Data + Signals */}
        <div className="grid grid-rows-[auto_1fr] gap-px bg-[#1a1a2e]/50 overflow-hidden min-h-[300px] xl:min-h-0">
          <Panel title="Market Data" icon="📊" badge={Object.keys(prices).length} className="max-h-[240px]">
            <MarketTable prices={prices} selected={selectedSym} onSelect={setSelectedSym} />
          </Panel>
          <Panel title="AI Signali" icon="🎯" badge={signals.length}>
            <SignalsList signals={signals} />
          </Panel>
        </div>

        {/* BOTTOM-LEFT: Demo + Polymarket */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-[#1a1a2e]/50 overflow-hidden min-h-[200px] xl:min-h-0">
          <Panel title="Simulacija" icon="🧪" badge={`${demoOpenCount} open`}>
            <DemoPanel demoData={demoData} />
          </Panel>
          <Panel title="Polymarket" icon="🎲" badge={polyBets.length > 0 ? `${polyBets.length} bets` : undefined}>
            <PolyCompact bets={polyBets} markets={polyMarkets} />
          </Panel>
        </div>

        {/* BOTTOM-RIGHT: Agent Logs */}
        <Panel title="Agent Aktivnost" icon="🤖" badge={agentLogs.length} className="min-h-[200px] xl:min-h-0">
          <AgentLog logs={agentLogs as unknown as Array<Record<string, unknown>>} />
        </Panel>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Page() {
  return (
    <RealtimeProvider>
      <Terminal />
    </RealtimeProvider>
  )
}
