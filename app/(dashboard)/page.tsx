'use client'
import { useEffect, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { RealtimeProvider } from '@/components/providers/RealtimeProvider'
import type { Signal, MarketData, OHLCV } from '@/types'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }
function fmt(n: number | null | undefined, prefix = '$'): string {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 10000) return `${prefix}${n.toLocaleString('en', { maximumFractionDigits: 0 })}`
  if (Math.abs(n) >= 100) return `${prefix}${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `${prefix}${n.toFixed(2)}`
}
const SYM_SHORT: Record<string, string> = {
  'BTC/USD': 'BTC', 'ETH/USD': 'ETH', 'SOL/USD': 'SOL', 'BNB/USD': 'BNB',
  'XAU/USD': 'GOLD', 'BRENT': 'BRENT', 'SPY': 'SPY', 'QQQ': 'QQQ',
  'EUR/USD': 'EUR', 'USD/JPY': 'JPY', 'XAG/USD': 'SILVER', 'WTI': 'WTI',
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANDLESTICK CHART (CSS var colors)
// ═══════════════════════════════════════════════════════════════════════════════

function CandlestickChart({ candles, symbol }: { candles: OHLCV[]; symbol: string }) {
  const W = 960, H = 340, VOL_H = 45, PAD_R = 68, PAD_T = 8, PAD_B = 18
  const CHART_H = H - VOL_H - PAD_B - PAD_T, chartW = W - PAD_R
  if (!candles.length) return <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs">Loading chart...</div>
  const data = candles.slice(-100)
  const pMin = Math.min(...data.map(c => c.low)) * 0.999, pMax = Math.max(...data.map(c => c.high)) * 1.001
  const vMax = Math.max(...data.map(c => c.volume)) || 1
  const gap = chartW / data.length, cw = Math.max(1, gap * 0.65)
  const yP = (p: number) => PAD_T + (1 - (p - pMin) / (pMax - pMin)) * CHART_H
  const yV = (v: number) => H - PAD_B - (v / vMax) * VOL_H
  const priceStep = (pMax - pMin) / 5
  const gridLines = Array.from({ length: 6 }, (_, i) => pMin + priceStep * i)
  const closes = data.map(c => c.close)
  const ema20: number[] = [closes[0]]
  for (let i = 1; i < closes.length; i++) ema20.push(closes[i] * (2 / 21) + ema20[i - 1] * (1 - 2 / 21))
  const emaPath = ema20.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * gap + gap / 2},${yP(v)}`).join(' ')
  const lastPrice = data[data.length - 1]?.close ?? 0, lastY = yP(lastPrice)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {gridLines.map((p, i) => (
        <g key={i}>
          <line x1={0} y1={yP(p)} x2={chartW} y2={yP(p)} stroke="var(--chart-grid)" strokeWidth={0.5} />
          <text x={chartW + 4} y={yP(p) + 3} fill="var(--text-muted)" fontSize={8.5} fontFamily="monospace">{p >= 1000 ? p.toFixed(0) : p.toFixed(2)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const isUp = d.close >= d.open
        return <rect key={`v${i}`} x={i * gap + (gap - cw) / 2} y={yV(d.volume)} width={cw} height={H - PAD_B - yV(d.volume)} fill={isUp ? 'var(--chart-up)' : 'var(--chart-dn)'} opacity={0.12} />
      })}
      <path d={emaPath} fill="none" stroke="var(--chart-ema)" strokeWidth={1} opacity={0.6} />
      {data.map((d, i) => {
        const x = i * gap + gap / 2, isUp = d.close >= d.open
        const color = isUp ? 'var(--chart-up)' : 'var(--chart-dn)'
        const bodyTop = yP(Math.max(d.open, d.close)), bodyBot = yP(Math.min(d.open, d.close))
        return (
          <g key={`c${i}`}>
            <line x1={x} y1={yP(d.high)} x2={x} y2={yP(d.low)} stroke={color} strokeWidth={0.8} />
            <rect x={x - cw / 2} y={bodyTop} width={cw} height={Math.max(bodyBot - bodyTop, 0.5)} fill={color} rx={0.3} />
          </g>
        )
      })}
      <line x1={0} y1={lastY} x2={chartW} y2={lastY} stroke="var(--chart-price-bg)" strokeWidth={0.5} strokeDasharray="3 2" />
      <rect x={chartW} y={lastY - 8} width={PAD_R - 2} height={16} rx={2} fill="var(--chart-price-bg)" />
      <text x={chartW + 4} y={lastY + 4} fill="white" fontSize={8.5} fontWeight="bold" fontFamily="monospace">{lastPrice >= 1000 ? lastPrice.toFixed(0) : lastPrice.toFixed(2)}</text>
      <text x={8} y={18} fill="var(--text-muted)" fontSize={10} fontWeight="bold" fontFamily="monospace" letterSpacing={1}>{symbol} 1H</text>
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function Panel({ title, badge, children, className = '' }: { title: string; badge?: string | number; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg overflow-hidden', className)} style={{ boxShadow: 'var(--shadow)' }}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] flex-shrink-0">
        <span className="text-[9px] font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase">{title}</span>
        {badge !== undefined && <span className="text-[8px] font-bold text-[var(--text-secondary)] bg-[var(--bg-hover)] px-1.5 py-0.5 rounded">{badge}</span>}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET TABLE
// ═══════════════════════════════════════════════════════════════════════════════

function MarketTable({ prices, selected, onSelect }: { prices: Record<string, MarketData>; selected: string; onSelect: (s: string) => void }) {
  const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT', 'SPY', 'QQQ', 'EUR/USD', 'USD/JPY']
  return (
    <div className="text-[10px]">
      <div className="grid grid-cols-[1fr_80px_60px] px-2 py-1 text-[8px] text-[var(--text-muted)] tracking-wider border-b border-[var(--border-light)]">
        <span>SYMBOL</span><span className="text-right">PRICE</span><span className="text-right">24H</span>
      </div>
      {symbols.map(sym => {
        const d = prices[sym]
        if (!d) return null
        const pct = d.change_pct_24h ?? 0
        return (
          <div key={sym} onClick={() => onSelect(sym)} className={cn(
            'grid grid-cols-[1fr_80px_60px] px-2 py-[5px] cursor-pointer transition-colors border-b border-[var(--border-light)]',
            selected === sym ? 'bg-[var(--bg-hover)] border-l-2 border-l-[var(--blue)]' : 'hover:bg-[var(--bg-hover)] border-l-2 border-l-transparent'
          )}>
            <span className="font-bold text-[var(--text-primary)]">{SYM_SHORT[sym] ?? sym}</span>
            <span className="text-right mono font-bold text-[var(--text-primary)]">{d.price >= 1000 ? d.price.toLocaleString('en', { maximumFractionDigits: 0 }) : d.price.toFixed(2)}</span>
            <span className={cn('text-right font-bold mono', pct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
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
      {signals.slice(0, 8).map(s => (
        <div key={s.id} className="px-2 py-2 border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)] transition-colors">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[10px] text-[var(--text-primary)]">{s.instrument}</span>
              <span className={cn('text-[8px] font-black px-1.5 py-0.5 rounded',
                s.direction === 'long' ? 'bg-green-50 text-[var(--green)]' : s.direction === 'short' ? 'bg-red-50 text-[var(--red)]' : 'bg-amber-50 text-[var(--amber)]'
              )}>{s.direction.toUpperCase()}</span>
              <span className="text-[8px] text-[var(--blue)] font-bold">R:R {s.risk_reward ?? '—'}x</span>
            </div>
            <span className="text-[8px] font-bold text-[var(--text-secondary)]">{s.confidence}%</span>
          </div>
          <div className="flex gap-3 text-[9px] mono text-[var(--text-secondary)]">
            <span>E: <span className="text-[var(--text-primary)]">{fmt(s.entry_price)}</span></span>
            <span>SL: <span className="text-[var(--red)]">{fmt(s.stop_loss)}</span></span>
            <span>TP: <span className="text-[var(--green)]">{fmt(s.take_profit_1)}</span></span>
          </div>
          <div className="text-[8px] text-[var(--text-muted)] mt-1">{s.reasoning}</div>
        </div>
      ))}
      {signals.length === 0 && <div className="text-center py-6 text-[var(--text-muted)] text-[10px]">Waiting for signals...</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO / SIMULATION
// ═══════════════════════════════════════════════════════════════════════════════

function DemoPanel({ demoData }: { demoData: { session: Record<string, unknown> | null; trades: Array<Record<string, unknown>> } }) {
  const s = demoData.session
  if (!s) return <div className="text-center py-4 text-[var(--text-muted)] text-[10px]">No demo session</div>
  const openTrades = demoData.trades.filter(t => !t.exit_time)
  const closedTrades = demoData.trades.filter(t => t.exit_time)
  const pnl = Number(s.total_pnl || 0)
  const wins = Number(s.win_count || 0), losses = Number(s.loss_count || 0)
  return (
    <div className="text-[10px]">
      <div className="flex gap-0 border-b border-[var(--border)]">
        {[
          { l: 'CAPITAL', v: `${Number(s.initial_capital || 0).toLocaleString()}` },
          { l: 'P&L', v: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}`, cls: pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
          { l: 'W/L', v: `${wins}/${losses}` },
        ].map(st => (
          <div key={st.l} className="flex-1 px-2 py-1.5 border-r border-[var(--border)] last:border-r-0">
            <div className="text-[7px] text-[var(--text-muted)] tracking-wider">{st.l}</div>
            <div className={cn('font-bold mono text-[11px]', st.cls || 'text-[var(--text-primary)]')}>{st.v}</div>
          </div>
        ))}
      </div>
      {openTrades.map((t, i) => {
        const livePnl = Number(t.live_pnl_aed || 0)
        return (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)]">
            <span className={cn('w-1.5 h-1.5 rounded-full', String(t.direction) === 'long' ? 'bg-[var(--green)]' : 'bg-[var(--red)]')} />
            <span className="font-bold text-[var(--text-primary)] w-12">{SYM_SHORT[String(t.instrument)] ?? t.instrument}</span>
            <span className="mono text-[var(--text-secondary)] flex-1">@ {fmt(Number(t.entry_price))}</span>
            <span className={cn('mono font-bold', livePnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{livePnl >= 0 ? '+' : ''}{livePnl.toFixed(0)}</span>
          </div>
        )
      })}
      {closedTrades.slice(0, 3).map((t, i) => {
        const p = Number(t.pnl_aed || 0)
        return (
          <div key={`c${i}`} className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border-light)] opacity-50">
            <span className={cn('w-1.5 h-1.5 rounded-full', p > 0 ? 'bg-[var(--green)]' : 'bg-[var(--red)]')} />
            <span className="text-[var(--text-secondary)] w-12">{SYM_SHORT[String(t.instrument)] ?? t.instrument}</span>
            <span className="text-[8px] text-[var(--text-muted)]">{String(t.exit_reason) === 'take_profit' ? 'TP' : 'SL'}</span>
            <span className="flex-1" />
            <span className={cn('mono font-bold', p > 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{p > 0 ? '+' : ''}{p.toFixed(0)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE BLOG
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_META: Record<string, { icon: string; name: string }> = {
  'orchestrator': { icon: '🧠', name: 'Orchestrator' },
  'market-analyst': { icon: '📰', name: 'Analyst' },
  'risk-manager': { icon: '🛡', name: 'Risk Mgr' },
  'polymarket-scanner': { icon: '🔮', name: 'Polymarket' },
  'trade-reviewer': { icon: '📊', name: 'Reviewer' },
}

function LiveBlog({ logs }: { logs: Array<Record<string, unknown>> }) {
  return (
    <div>
      <div className="flex gap-px border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        {Object.entries(AGENT_META).map(([id, meta]) => {
          const last = logs.find(l => String(l.agent) === id)
          const isActive = last && (Date.now() - new Date(String(last.created_at)).getTime()) < 3600_000
          const time = last?.created_at ? new Date(String(last.created_at)).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '—'
          return (
            <div key={id} className="flex-1 px-2 py-1.5 border-r border-[var(--border)] last:border-r-0">
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px]">{meta.icon}</span>
                <span className="text-[8px] font-bold text-[var(--text-secondary)]">{meta.name}</span>
                <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-[var(--green)] animate-pulse' : 'bg-[var(--text-muted)]')} />
              </div>
              <div className="text-[8px] text-[var(--text-muted)] mono">{time}</div>
            </div>
          )
        })}
      </div>
      {logs.slice(0, 25).map((log, i) => {
        const level = String(log.level ?? 'info')
        const dotCls = level === 'ok' ? 'bg-[var(--green)]' : level === 'warn' ? 'bg-[var(--amber)]' : level === 'error' ? 'bg-[var(--red)]' : 'bg-[var(--text-muted)]'
        const time = log.created_at ? new Date(String(log.created_at)).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : ''
        return (
          <div key={i} className="flex items-start gap-2 px-3 py-1.5 border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)]">
            <div className={cn('w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0', dotCls)} />
            <span className="text-[8px] text-[var(--text-muted)] mono w-10 flex-shrink-0">{time}</span>
            <span className="text-[8px] font-bold text-[var(--purple)] w-8 flex-shrink-0">{String(log.agent ?? '').split('-').map((w: string) => w[0]?.toUpperCase() ?? '').join('')}</span>
            <span className="text-[9px] text-[var(--text-secondary)] leading-tight">{String(log.message ?? '').slice(0, 120)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLYMARKET
// ═══════════════════════════════════════════════════════════════════════════════

function PolyCompact({ bets, markets }: { bets: Array<Record<string, unknown>>; markets: Array<Record<string, unknown>> }) {
  return (
    <div>
      {bets.length > 0 && bets.slice(0, 3).map((b, i) => (
        <div key={i} className="px-2 py-1.5 border-b border-[var(--border-light)]">
          <div className="flex items-center gap-1.5">
            <span className={cn('text-[8px] font-black px-1 rounded', String(b.side) === 'YES' ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]')}>{String(b.side)}</span>
            <span className="text-[9px] text-[var(--text-primary)] truncate">{String(b.question).slice(0, 55)}</span>
          </div>
        </div>
      ))}
      {markets.slice(0, 6).map((m, i) => (
        <div key={i} className="flex items-center justify-between px-2 py-1 border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)]">
          <span className="text-[9px] text-[var(--text-secondary)] truncate flex-1 pr-2">{String(m.question).slice(0, 50)}</span>
          <span className={cn('text-[10px] font-bold mono', Number(m.yes_price) > 0.6 ? 'text-[var(--green)]' : Number(m.yes_price) < 0.4 ? 'text-[var(--red)]' : 'text-[var(--amber)]')}>
            {(Number(m.yes_price) * 100).toFixed(0)}%
          </span>
        </div>
      ))}
      {markets.length === 0 && bets.length === 0 && <div className="text-center py-4 text-[var(--text-muted)] text-[9px]">Loading prediction markets...</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TERMINAL
// ═══════════════════════════════════════════════════════════════════════════════

function Terminal() {
  const { theme, toggle } = useTheme()
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

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const store = useStore.getState()
    fetch('/api/prices').then(r => r.json()).then(d => {
      if (d.data && Array.isArray(d.data)) {
        store.setPrices(d.data.map((item: Record<string, unknown>) => ({
          ...item, price: Number(item.price) || 0, change_24h: Number(item.change_24h) || 0,
          change_pct_24h: Number(item.change_pct_24h) || 0, volume_24h: Number(item.volume_24h) || 0,
          high_24h: Number(item.high_24h) || 0, low_24h: Number(item.low_24h) || 0,
          open_24h: Number(item.open_24h) || 0, market_cap: item.market_cap ? Number(item.market_cap) : null,
        })))
      }
    }).catch(() => {})
    fetch('/api/signals').then(r => r.json()).then(d => { if (d.data) store.setSignals(d.data) }).catch(() => {})
    fetch('/api/agent-logs').then(r => r.json()).then(d => { if (d.data) d.data.forEach((log: import('@/types').AgentLog) => store.addAgentLog(log)) }).catch(() => {})
    fetch('/api/polymarket/bets').then(r => r.json()).then(d => { if (d.data) setPolyBets(d.data) }).catch(() => {})
    fetch('/api/polymarket/markets').then(r => r.json()).then(d => { if (d.data) setPolyMarkets(d.data) }).catch(() => {})
    fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
  }, [])

  const fetchCandles = useCallback((sym: string) => {
    fetch(`/api/prices?symbol=${encodeURIComponent(sym)}&candles=true&interval=1h&limit=100`)
      .then(r => r.json()).then(d => { if (d.data) setCandles(d.data) }).catch(() => {})
  }, [])
  useEffect(() => { fetchCandles(selectedSym) }, [selectedSym, fetchCandles])

  useEffect(() => {
    const t = setInterval(() => {
      fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemoData({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const selectedPrice = prices[selectedSym]
  const tickers = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT', 'SPY']
  const demoPnl = Number(demoData.session?.total_pnl || 0)
  const demoOpen = demoData.trades.filter(t => !t.exit_time).length

  return (
    <div className="flex flex-col h-screen select-none" style={{ background: 'var(--bg-primary)' }}>
      {/* ═══ HEADER ═══ */}
      <header className="flex items-center h-10 border-b border-[var(--border)] flex-shrink-0 px-3 gap-4" style={{ background: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-black tracking-tight text-[var(--text-primary)]">APEX</span>
          <span className="flex items-center gap-1 text-[8px] font-bold text-[var(--green)] tracking-[0.15em] px-1.5 py-0.5 border border-[var(--green)]/20 rounded bg-[var(--green)]/5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />LIVE
          </span>
          <a href="/investor" className="text-[8px] text-[var(--text-muted)] hover:text-[var(--blue)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors">INVESTOR</a>
          <a href="/settings" className="text-[8px] text-[var(--text-muted)] hover:text-[var(--blue)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors">SETTINGS</a>
        </div>
        <div className="flex items-center gap-3 flex-1 overflow-hidden">
          {tickers.map(sym => {
            const d = prices[sym]
            if (!d) return null
            const pct = d.change_pct_24h ?? 0
            return (
              <button key={sym} onClick={() => setSelectedSym(sym)} className={cn(
                'flex items-center gap-1.5 text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded transition-colors',
                selectedSym === sym ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
              )}>
                <span className="font-bold text-[var(--text-secondary)]">{SYM_SHORT[sym]}</span>
                <span className="mono font-bold text-[var(--text-primary)]">{d.price >= 1000 ? d.price.toLocaleString('en', { maximumFractionDigits: 0 }) : d.price.toFixed(2)}</span>
                <span className={cn('mono font-bold', pct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-4 flex-shrink-0 text-[10px]">
          <div className="text-right"><div className="text-[7px] text-[var(--text-muted)]">DEMO P&L</div><div className={cn('font-bold mono', demoPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{demoPnl >= 0 ? '+' : ''}{demoPnl.toFixed(0)}</div></div>
          <div className="text-right"><div className="text-[7px] text-[var(--text-muted)]">OPEN</div><div className="font-bold mono text-[var(--blue)]">{demoOpen}</div></div>
          <div className="text-right"><div className="text-[7px] text-[var(--text-muted)]">F&G</div><div className={cn('font-bold mono', fearGreedIndex > 60 ? 'text-[var(--green)]' : fearGreedIndex < 40 ? 'text-[var(--red)]' : 'text-[var(--amber)]')}>{fearGreedIndex}</div></div>
          <div className="text-right"><div className="text-[7px] text-[var(--text-muted)]">ABU DHABI</div><div className="font-bold mono text-[var(--blue)]">{clock}</div></div>
          <button onClick={toggle} className="text-[9px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      {/* ═══ INSTRUMENT TABS ═══ */}
      <div className="flex items-center h-7 border-b border-[var(--border)] flex-shrink-0 px-2 gap-0.5" style={{ background: 'var(--bg-secondary)' }}>
        {['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD', 'BRENT'].map(sym => (
          <button key={sym} onClick={() => setSelectedSym(sym)} className={cn(
            'px-3 py-1 text-[9px] font-bold rounded-sm transition-colors',
            selectedSym === sym ? 'bg-[var(--bg-hover)] text-[var(--blue)] border-b-2 border-[var(--blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          )}>{SYM_SHORT[sym]}</button>
        ))}
        <div className="flex-1" />
        {selectedPrice && (
          <div className="flex items-center gap-3 text-[10px]">
            <span className="mono font-bold text-[var(--text-primary)]">{fmt(selectedPrice.price)}</span>
            <span className={cn('mono font-bold', (selectedPrice.change_pct_24h ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
              {(selectedPrice.change_pct_24h ?? 0) >= 0 ? '+' : ''}{(selectedPrice.change_pct_24h ?? 0).toFixed(2)}%
            </span>
            <span className="text-[var(--text-muted)]">H: <span className="text-[var(--text-secondary)] mono">{fmt(selectedPrice.high_24h)}</span></span>
            <span className="text-[var(--text-muted)]">L: <span className="text-[var(--text-secondary)] mono">{fmt(selectedPrice.low_24h)}</span></span>
            <span className="text-[var(--text-muted)]">Vol: <span className="text-[var(--text-secondary)] mono">{selectedPrice.volume_24h >= 1e6 ? `$${(selectedPrice.volume_24h / 1e6).toFixed(1)}M` : `$${selectedPrice.volume_24h.toLocaleString()}`}</span></span>
          </div>
        )}
      </div>

      {/* ═══ MAIN GRID ═══ */}
      <div className="flex-1 flex flex-col xl:grid xl:grid-cols-[1fr_320px] xl:grid-rows-[1fr_1fr] gap-px overflow-auto xl:overflow-hidden min-h-0" style={{ background: 'var(--border)' }}>
        <div className="overflow-hidden min-h-[280px] xl:min-h-0" style={{ background: 'var(--bg-panel)' }}>
          <CandlestickChart candles={candles} symbol={selectedSym} />
        </div>
        <div className="grid grid-rows-[auto_1fr] gap-px min-h-[260px] xl:min-h-0" style={{ background: 'var(--border)' }}>
          <Panel title="Market Data" badge={Object.keys(prices).length} className="max-h-[200px]">
            <MarketTable prices={prices} selected={selectedSym} onSelect={setSelectedSym} />
          </Panel>
          <Panel title="AI Signals" badge={signals.length}>
            <SignalsList signals={signals} />
          </Panel>
        </div>
        <Panel title="Live Blog" badge="LIVE" className="min-h-[280px] xl:min-h-0">
          <LiveBlog logs={agentLogs as unknown as Array<Record<string, unknown>>} />
        </Panel>
        <div className="grid grid-rows-2 gap-px min-h-[280px] xl:min-h-0" style={{ background: 'var(--border)' }}>
          <Panel title="Simulation" badge={`${demoOpen} open`}>
            <DemoPanel demoData={demoData} />
          </Panel>
          <Panel title="Polymarket" badge={polyBets.length > 0 ? `${polyBets.length} bets` : undefined}>
            <PolyCompact bets={polyBets} markets={polyMarkets} />
          </Panel>
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <RealtimeProvider><Terminal /></RealtimeProvider>
}
