'use client'
import { CryptoScreener } from '@/components/widgets/CryptoScreener'
import { useTheme } from '@/lib/theme'

export default function ScreenerPage() {
  const { theme } = useTheme()
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>CRYPTO SCREENER</span>
        <div className="flex-1" />
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>Sort by market cap, performance, oscillators, moving averages</span>
      </div>
      <div className="flex-1 min-h-0">
        <CryptoScreener colorTheme={theme === 'dark' ? 'dark' : 'light'} />
      </div>
    </div>
  )
}
