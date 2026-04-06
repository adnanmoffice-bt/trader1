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
// LIVE BLOG — Narrative feed of what agents are doing and why
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_META: Record<string, { icon: string; name: string; color: string; desc: string }> = {
  'orchestrator':        { icon: '🧠', name: 'Orchestrator',       color: '#9966ff', desc: 'Master AI that coordinates all trading agents' },
  'market-analyst':      { icon: '📰', name: 'Market Analyst',     color: '#4d88ff', desc: 'Reads news, analyzes market sentiment' },
  'signal-generator':    { icon: '🎯', name: 'Signal Generator',   color: '#00ffa3', desc: 'Technical analysis → trade signals' },
  'risk-manager':        { icon: '🛡️', name: 'Risk Manager',       color: '#ffcc00', desc: 'Validates R:R, position sizing, exposure' },
  'trade-reviewer':      { icon: '📊', name: 'Trade Reviewer',     color: '#00ccff', desc: 'End-of-day performance analysis' },
  'polymarket-scanner':  { icon: '🔮', name: 'Polymarket Scanner', color: '#ff66cc', desc: 'AI prediction market analysis' },
}

function narratize(agent: string, level: string, message: string): { headline: string; detail: string; type: 'action' | 'analysis' | 'decision' | 'result' } {
  const msg = message

  // Orchestrator
  if (agent === 'orchestrator' && msg.includes('Pipeline started')) {
    return { headline: 'Trading pipeline started', detail: 'Scanning all instruments for opportunities using technical indicators + AI sentiment analysis.', type: 'action' }
  }
  if (agent === 'orchestrator' && msg.includes('Pipeline complete')) {
    const parts = msg.split('—')[1]?.trim() ?? msg
    return { headline: 'Pipeline scan complete', detail: `Results: ${parts}. Each instrument was analyzed for RSI, MACD, Bollinger Bands, EMA crossovers, and volume.`, type: 'result' }
  }
  if (agent === 'orchestrator' && msg.includes('HOLD')) {
    const match = msg.match(/(\w+\/?\w*): HOLD \(conf (\d+)%\)/)
    if (match) return { headline: `${match[1]}: No trade — HOLD`, detail: `Confidence only ${match[2]}% (need 65%+). Indicators don't show clear direction. Waiting for stronger setup.`, type: 'decision' }
  }
  if (agent === 'orchestrator' && msg.includes('signal saved')) {
    const match = msg.match(/(\w+\/?\w*): signal saved.*?(\w+)\s+conf\s*(\d+)%/)
    if (match) return { headline: `${match[2].toUpperCase()} signal generated for ${match[1]}`, detail: `AI confidence: ${match[3]}%. Signal saved and sent to Telegram. Waiting for price to reach entry level.`, type: 'action' }
  }
  if (agent === 'orchestrator' && msg.includes('insufficient')) {
    return { headline: `Skipping — not enough historical data`, detail: msg + '. Need at least 30 hourly candles for reliable indicator calculation.', type: 'analysis' }
  }

  // Risk Manager
  if (agent === 'risk-manager' && msg.includes('approved')) {
    const match = msg.match(/(\w+\/?\w*):.*?(\w+)\s+conf:(\d+)%\s+R:R:([0-9.]+)/)
    if (match) return { headline: `Risk approved: ${match[2].toUpperCase()} ${match[1]}`, detail: `Confidence ${match[3]}%, Risk:Reward ${match[4]}x. Position size within limits, stop loss acceptable.`, type: 'decision' }
  }
  if (agent === 'risk-manager' && msg.includes('rejected')) {
    return { headline: `Trade rejected by risk manager`, detail: msg.replace(/.*?:/, '').trim() + ' — protecting capital from unfavorable setup.', type: 'decision' }
  }

  // Market Analyst
  if (agent === 'market-analyst') {
    const match = msg.match(/(\w+\/?\w*): (\w+) — (.+)/)
    if (match) return { headline: `${match[1]} sentiment: ${match[2].toUpperCase()}`, detail: `AI analysis: "${match[3]}"`, type: 'analysis' }
  }

  // Polymarket
  if (agent === 'polymarket-scanner' && msg.includes('Scanning')) {
    return { headline: 'Scanning prediction markets', detail: 'AI is analyzing Polymarket events for mispriced probabilities where our model disagrees with the market.', type: 'action' }
  }
  if (agent === 'polymarket-scanner' && msg.includes('Found')) {
    return { headline: msg, detail: 'Filtering for markets with >$10K volume, between 5%-95% probability. Only betting when AI edge > 15%.', type: 'analysis' }
  }
  if (agent === 'polymarket-scanner' && msg.includes('Scan complete')) {
    const match = msg.match(/(\d+) markets.*?(\d+) bets/)
    if (match) return { headline: `Polymarket scan done: ${match[1]} markets, ${match[2]} bets`, detail: match[2] === '0' ? 'No markets with sufficient AI edge (>15%) found. Preserving capital.' : `Placed ${match[2]} bets where AI probability differs significantly from market.`, type: 'result' }
  }
  if (agent === 'polymarket-scanner' && msg.includes('Market:')) {
    const match = msg.match(/"(.+?)"\s+Market:(\d+)%\s+AI:(\d+)%\s+Edge:([0-9.]+)%/)
    if (match) {
      const edge = parseFloat(match[4])
      const action = edge >= 15 ? 'BETTING — edge is significant!' : edge >= 8 ? 'Watching — close to threshold' : 'Skipping — edge too small'
      return { headline: `"${match[1]}"`, detail: `Market says ${match[2]}%, AI estimates ${match[3]}% — Edge: ${match[4]}%. ${action}`, type: 'analysis' }
    }
  }
  if (agent === 'polymarket-scanner' && msg.includes('BET:')) {
    return { headline: 'Bet placed on Polymarket!', detail: msg.replace('BET: ', ''), type: 'action' }
  }

  // Default
  return {
    headline: msg.slice(0, 80),
    detail: msg.length > 80 ? msg.slice(80) : '',
    type: level === 'error' ? 'decision' : level === 'ok' ? 'result' : 'analysis'
  }
}

function AgentStatusBar({ logs }: { logs: Array<Record<string, unknown>> }) {
  const agents = ['orchestrator', 'market-analyst', 'risk-manager', 'polymarket-scanner', 'trade-reviewer'] as const
  return (
    <div className="flex gap-px border-b border-[#1a1a2e] bg-[#0a0a16]">
      {agents.map(id => {
        const meta = AGENT_META[id]
        if (!meta) return null
        const lastLog = logs.find(l => String(l.agent) === id)
        const lastTime = lastLog?.created_at
          ? new Date(String(lastLog.created_at)).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })
          : '—'
        const lastLevel = String(lastLog?.level ?? '')
        const isActive = lastLog && (Date.now() - new Date(String(lastLog.created_at)).getTime()) < 3600_000
        return (
          <div key={id} className="flex-1 px-2 py-1.5 border-r border-[#1a1a2e] last:border-r-0 hover:bg-[#0f0f1e] transition-colors">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px]">{meta.icon}</span>
              <span className="text-[8px] font-bold tracking-wider" style={{ color: meta.color }}>{meta.name.split(' ')[0]}</span>
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                isActive ? (lastLevel === 'error' ? 'bg-[#ff3366]' : 'bg-[#00ffa3] animate-pulse') : 'bg-[#44446a]'
              )} />
            </div>
            <div className="text-[8px] text-[#44446a] mono">{lastTime}</div>
          </div>
        )
      })}
    </div>
  )
}

function LiveBlog({ logs }: { logs: Array<Record<string, unknown>> }) {
  const typeStyles = {
    action:   { bg: 'bg-[rgba(0,204,255,0.04)]', border: 'border-l-[#00ccff]', label: 'ACTION', labelBg: 'bg-[rgba(0,204,255,0.12)] text-[#00ccff]' },
    analysis: { bg: 'bg-transparent',              border: 'border-l-[#44446a]', label: 'ANALIZA', labelBg: 'bg-[#141428] text-[#7878aa]' },
    decision: { bg: 'bg-[rgba(255,204,0,0.03)]',   border: 'border-l-[#ffcc00]', label: 'ODLUKA', labelBg: 'bg-[rgba(255,204,0,0.1)] text-[#ffcc00]' },
    result:   { bg: 'bg-[rgba(0,255,163,0.03)]',   border: 'border-l-[#00ffa3]', label: 'REZULTAT', labelBg: 'bg-[rgba(0,255,163,0.1)] text-[#00ffa3]' },
  }

  return (
    <div>
      <AgentStatusBar logs={logs} />
      {logs.slice(0, 40).map((log, i) => {
        const agent = String(log.agent ?? '')
        const level = String(log.level ?? 'info')
        const message = String(log.message ?? '')
        const meta = AGENT_META[agent] ?? { icon: '⚡', name: agent, color: '#44446a', desc: '' }
        const { headline, detail, type } = narratize(agent, level, message)
        const style = typeStyles[type]
        const time = log.created_at
          ? new Date(String(log.created_at)).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : ''

        return (
          <div key={i} className={cn('flex gap-3 px-4 py-2.5 border-b border-[#0f0f1e] border-l-2 transition-colors hover:bg-[#0a0a16]', style.bg, style.border)}>
            {/* Timeline dot + time */}
            <div className="flex flex-col items-center gap-0.5 flex-shrink-0 w-16">
              <span className="text-[9px] mono text-[#44446a]">{time}</span>
              <span className="text-sm">{meta.icon}</span>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[8px] font-bold tracking-wider" style={{ color: meta.color }}>{meta.name}</span>
                <span className={cn('text-[7px] font-black px-1.5 py-0.5 rounded tracking-wider', style.labelBg)}>{style.label}</span>
                {level === 'error' && <span className="text-[7px] font-black px-1.5 py-0.5 rounded bg-[rgba(255,51,102,0.15)] text-[#ff3366]">ERROR</span>}
              </div>
              <div className="text-[11px] font-semibold text-[#e2e2f5] leading-snug">{headline}</div>
              {detail && <div className="text-[10px] text-[#7878aa] leading-snug mt-0.5">{detail}</div>}
            </div>
          </div>
        )
      })}
      {logs.length === 0 && (
        <div className="flex items-center justify-center py-8 text-[#44446a]">
          <div className="text-center">
            <div className="text-xl mb-2">📡</div>
            <div className="text-[11px] font-bold">Live Blog</div>
            <div className="text-[10px] mt-1">Waiting for agent activity... Cron runs every 30 min.</div>
          </div>
        </div>
      )}
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
      <div className="flex-1 flex flex-col xl:grid xl:grid-cols-[1fr_320px] xl:grid-rows-[1fr_1fr] gap-px bg-[#1a1a2e]/50 overflow-auto xl:overflow-hidden min-h-0">

        {/* CHART PANEL (top-left) */}
        <div className="bg-[#07070f] overflow-hidden min-h-[280px] xl:min-h-0">
          <CandlestickChart candles={candles} symbol={selectedSym} />
        </div>

        {/* RIGHT TOP: Market Data + Signals */}
        <div className="grid grid-rows-[auto_1fr] gap-px bg-[#1a1a2e]/50 overflow-hidden min-h-[260px] xl:min-h-0">
          <Panel title="Market Data" icon="📊" badge={Object.keys(prices).length} className="max-h-[200px]">
            <MarketTable prices={prices} selected={selectedSym} onSelect={setSelectedSym} />
          </Panel>
          <Panel title="AI Signali" icon="🎯" badge={signals.length}>
            <SignalsList signals={signals} />
          </Panel>
        </div>

        {/* BOTTOM-LEFT: LIVE BLOG (full narrative feed) */}
        <Panel title="Live Blog — What's Happening" icon="📡" badge="LIVE" className="min-h-[280px] xl:min-h-0">
          <LiveBlog logs={agentLogs as unknown as Array<Record<string, unknown>>} />
        </Panel>

        {/* BOTTOM-RIGHT: Simulacija + Polymarket stacked */}
        <div className="grid grid-rows-2 gap-px bg-[#1a1a2e]/50 overflow-hidden min-h-[280px] xl:min-h-0">
          <Panel title="Simulacija" icon="🧪" badge={`${demoOpenCount} open`}>
            <DemoPanel demoData={demoData} />
          </Panel>
          <Panel title="Polymarket" icon="🔮" badge={polyBets.length > 0 ? `${polyBets.length} bets` : undefined}>
            <PolyCompact bets={polyBets} markets={polyMarkets} />
          </Panel>
        </div>
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
