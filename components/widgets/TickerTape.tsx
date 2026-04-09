'use client'
import { useEffect, useRef } from 'react'

interface TickerTapeProps {
  symbols?: { proName: string; title: string }[]
  colorTheme?: 'dark' | 'light'
  isTransparent?: boolean
  displayMode?: 'adaptive' | 'regular' | 'compact'
}

const DEFAULT_SYMBOLS = [
  { proName: 'BINANCE:BTCUSDT', title: 'BTC/USD' },
  { proName: 'BINANCE:ETHUSDT', title: 'ETH/USD' },
  { proName: 'BINANCE:SOLUSDT', title: 'SOL/USD' },
  { proName: 'BINANCE:BNBUSDT', title: 'BNB/USD' },
  { proName: 'TVC:GOLD', title: 'GOLD' },
  { proName: 'NYMEX:CL1!', title: 'OIL' },
  { proName: 'AMEX:SPY', title: 'SPY' },
  { proName: 'NASDAQ:QQQ', title: 'QQQ' },
  { proName: 'BINANCE:DOGEUSDT', title: 'DOGE' },
  { proName: 'BINANCE:AVAXUSDT', title: 'AVAX' },
  { proName: 'FX:EURUSD', title: 'EUR/USD' },
]

export function TickerTape({
  symbols = DEFAULT_SYMBOLS,
  colorTheme = 'dark',
  isTransparent = true,
  displayMode = 'compact',
}: TickerTapeProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      symbols,
      showSymbolLogo: true,
      isTransparent,
      displayMode,
      colorTheme,
      locale: 'en',
    })

    const div = document.createElement('div')
    div.className = 'tradingview-widget-container__widget'
    containerRef.current.appendChild(div)
    containerRef.current.appendChild(script)
  }, [symbols, colorTheme, isTransparent, displayMode])

  return (
    <div className="tradingview-widget-container" ref={containerRef} style={{ height: 46 }} />
  )
}
