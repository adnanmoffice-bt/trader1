'use client'
import { EconomicCalendar } from '@/components/widgets/EconomicCalendar'
import { MarketOverview } from '@/components/widgets/MarketOverview'
import { useTheme } from '@/lib/theme'

export default function CalendarPage() {
  const { theme } = useTheme()
  const ct = theme === 'dark' ? 'dark' as const : 'light' as const

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>ECONOMIC CALENDAR & MARKET OVERVIEW</span>
        <div className="flex-1" />
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>Macro events affecting crypto & traditional markets</span>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-px" style={{ background: 'var(--border)' }}>
        <div className="lg:col-span-2" style={{ background: 'var(--bg-1)' }}>
          <EconomicCalendar colorTheme={ct} />
        </div>
        <div style={{ background: 'var(--bg-1)' }}>
          <MarketOverview colorTheme={ct} />
        </div>
      </div>
    </div>
  )
}
