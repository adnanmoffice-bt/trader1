'use client'

import { useStore } from '@/lib/store'
import { useEffect, useState } from 'react'

export function StatusBar() {
  const { portfolio, positions, prices, news } = useStore()
  const [time, setTime] = useState('')
  const [newsIdx, setNewsIdx] = useState(0)

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
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
      height: 24,
      fontSize: 11,
      padding: '0 8px',
      gap: 16,
      color: 'var(--text-2)',
      flexShrink: 0,
    }}>
      <span style={{ color: 'var(--amber)', fontWeight: 700 }}>APEX</span>
      <span>🕐 {time} UAE</span>
      <span style={{ borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
        💰 ${cap.toLocaleString('en', { maximumFractionDigits: 0 })}
      </span>
      <span>
        📊 P&L: <span style={{ color: pnlColor, fontWeight: 600 }}>
          {totalUnrealizedPnl >= 0 ? '+' : ''}{totalUnrealizedPnl.toFixed(2)}
        </span>
      </span>
      <span>📈 {positions.length}/3 pos</span>

      {/* Scrolling prices */}
      <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', position: 'relative' }}>
        <div style={{
          display: 'inline-flex', gap: 16,
          animation: 'ticker-scroll 30s linear infinite',
        }}>
          {priceList.map(p => (
            <span key={p.symbol} style={{ color: Number(p.change_pct_24h) >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {p.symbol} ${Number(p.price).toLocaleString('en', { maximumFractionDigits: p.price >= 100 ? 0 : 2 })}
              {' '}({Number(p.change_pct_24h) >= 0 ? '+' : ''}{Number(p.change_pct_24h).toFixed(1)}%)
            </span>
          ))}
          {priceList.map(p => (
            <span key={`dup-${p.symbol}`} style={{ color: Number(p.change_pct_24h) >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {p.symbol} ${Number(p.price).toLocaleString('en', { maximumFractionDigits: p.price >= 100 ? 0 : 2 })}
              {' '}({Number(p.change_pct_24h) >= 0 ? '+' : ''}{Number(p.change_pct_24h).toFixed(1)}%)
            </span>
          ))}
        </div>
      </div>

      {news.length > 0 && (
        <span style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
          📰 {news[newsIdx]?.headline}
        </span>
      )}
    </div>
  )
}
