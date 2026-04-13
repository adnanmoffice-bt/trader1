'use client'

import { useStore } from '@/lib/store'
import { useEffect, useState } from 'react'

function Dot({ color }: { color: string }) {
  return <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

export function StatusBar() {
  const { portfolio, positions, prices, news } = useStore()
  const [time, setTime] = useState('')
  const [newsIdx, setNewsIdx] = useState(0)

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (news.length === 0) return
    const iv = setInterval(() => setNewsIdx(i => (i + 1) % news.length), 5000)
    return () => clearInterval(iv)
  }, [news.length])

  const totalUnrealizedPnl = positions.reduce((s, p) => s + Number(p.unrealized_pnl ?? 0), 0)
  const pnlColor = totalUnrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)'
  const cap = portfolio?.available_capital ?? portfolio?.capital ?? 0
  const priceList = Object.values(prices)

  return (
    <div style={{
      background: 'var(--bg-1)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      height: 22,
      fontSize: 10,
      padding: '0 8px',
      gap: 0,
      color: 'var(--text-2)',
      flexShrink: 0,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {/* System Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 10 }}>
        <Dot color="var(--green)" />
        <span style={{ color: 'var(--amber)', fontWeight: 800, fontSize: 9, letterSpacing: '0.5px' }}>APEX</span>
      </div>

      {/* Clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 10 }}>
        <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--cyan)' }}>{time}</span>
        <span style={{ fontSize: 8, color: 'var(--text-3)' }}>DXB</span>
      </div>

      {/* Capital */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 10 }}>
        <span style={{ color: 'var(--text-3)', fontSize: 8 }}>CAP</span>
        <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-0)' }}>
          ${cap.toLocaleString('en', { maximumFractionDigits: 0 })}
        </span>
      </div>

      {/* P&L */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 10 }}>
        <span style={{ color: 'var(--text-3)', fontSize: 8 }}>P&L</span>
        <span className="tabular-nums" style={{ fontWeight: 700, color: pnlColor }}>
          {totalUnrealizedPnl >= 0 ? '+' : ''}{totalUnrealizedPnl.toFixed(2)}
        </span>
      </div>

      {/* Positions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 10 }}>
        <span style={{ color: 'var(--text-3)', fontSize: 8 }}>POS</span>
        <span style={{ fontWeight: 700, color: positions.length >= 3 ? 'var(--red)' : 'var(--text-0)' }}>{positions.length}/3</span>
      </div>

      {/* Scrolling Price Ticker */}
      <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', position: 'relative', maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)' }}>
        <div style={{ display: 'inline-flex', gap: 20, animation: 'ticker-scroll 40s linear infinite' }}>
          {[...priceList, ...priceList].map((p, i) => {
            const chg = Number(p.change_pct_24h)
            const up = chg >= 0
            return (
              <span key={`${p.symbol}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{p.symbol}</span>
                <span className="tabular-nums" style={{ color: 'var(--text-0)', fontWeight: 700 }}>
                  {Number(p.price) >= 100 ? Number(p.price).toLocaleString('en', { maximumFractionDigits: 0 }) : Number(p.price).toFixed(2)}
                </span>
                <span className="tabular-nums" style={{ color: up ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                  {up ? '▲' : '▼'}{Math.abs(chg).toFixed(1)}%
                </span>
              </span>
            )
          })}
        </div>
      </div>

      {/* News Headline */}
      {news.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: 280, paddingLeft: 10, borderLeft: '1px solid var(--border)', overflow: 'hidden' }}>
          <span style={{ color: 'var(--amber)', fontSize: 8, fontWeight: 800, flexShrink: 0 }}>NEWS</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
            {news[newsIdx]?.headline}
          </span>
        </div>
      )}
    </div>
  )
}
