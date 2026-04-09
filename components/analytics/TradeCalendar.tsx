'use client'
import { useState, useMemo } from 'react'

interface DayData {
  date: string
  daily_pnl: number
  trade_count: number
  win_count: number
  loss_count: number
}

export function TradeCalendar({ data }: { data: DayData[] }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const now = new Date()
  const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthName = viewDate.toLocaleString('en', { month: 'long', year: 'numeric' })

  const dayMap = useMemo(() => {
    const m = new Map<string, DayData>()
    for (const d of data) m.set(d.date, d)
    return m
  }, [data])

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (DayData & { day: number } | { day: number; empty: true })[] = []

  for (let i = 0; i < firstDay; i++) cells.push({ day: 0, empty: true })
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dayData = dayMap.get(dateStr)
    if (dayData) cells.push({ ...dayData, day: d })
    else cells.push({ day: d, empty: true })
  }

  const monthPnl = data.filter(d => d.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).reduce((s, d) => s + d.daily_pnl, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2">
        <button onClick={() => setMonthOffset(m => m - 1)} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: 'var(--text-2)', background: 'var(--bg-2)' }}>{'<'}</button>
        <div className="text-center">
          <span className="text-[11px] font-bold" style={{ color: 'var(--text-0)' }}>{monthName}</span>
          <span className="text-[9px] ml-2 font-bold" style={{ color: monthPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {monthPnl >= 0 ? '+' : ''}{monthPnl.toFixed(0)}
          </span>
        </div>
        <button onClick={() => setMonthOffset(m => m + 1)} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: 'var(--text-2)', background: 'var(--bg-2)' }}>{'>'}</button>
      </div>

      <div className="grid grid-cols-7 gap-px flex-1" style={{ background: 'var(--border)' }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[8px] font-bold py-0.5" style={{ color: 'var(--text-3)', background: 'var(--bg-1)' }}>{d}</div>
        ))}

        {cells.map((cell, i) => {
          if ('empty' in cell && cell.empty) {
            return <div key={i} style={{ background: 'var(--bg-1)' }} className="p-1 min-h-[36px]">
              {cell.day > 0 && <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{cell.day}</span>}
            </div>
          }
          const d = cell as DayData & { day: number }
          const pnlColor = d.daily_pnl > 0 ? 'var(--green)' : d.daily_pnl < 0 ? 'var(--red)' : 'var(--text-3)'
          const bgOpacity = Math.min(Math.abs(d.daily_pnl) / 500, 0.3)
          const bg = d.daily_pnl > 0 ? `rgba(34,197,94,${bgOpacity})` : d.daily_pnl < 0 ? `rgba(239,68,68,${bgOpacity})` : 'var(--bg-1)'

          return (
            <div key={i} className="p-1 min-h-[36px] flex flex-col" style={{ background: bg }}>
              <span className="text-[8px]" style={{ color: 'var(--text-3)' }}>{d.day}</span>
              <span className="text-[9px] font-bold" style={{ color: pnlColor }}>
                {d.daily_pnl > 0 ? '+' : ''}{d.daily_pnl.toFixed(0)}
              </span>
              <span className="text-[7px]" style={{ color: 'var(--text-3)' }}>
                {d.win_count}W {d.loss_count}L
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
