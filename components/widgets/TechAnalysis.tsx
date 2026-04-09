'use client'
import { useEffect, useRef } from 'react'

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USD': 'BINANCE:BTCUSDT',
  'ETH/USD': 'BINANCE:ETHUSDT',
  'SOL/USD': 'BINANCE:SOLUSDT',
  'BNB/USD': 'BINANCE:BNBUSDT',
  'XAU/USD': 'TVC:GOLD',
  'BRENT': 'NYMEX:CL1!',
  'SPY': 'AMEX:SPY',
  'QQQ': 'NASDAQ:QQQ',
}

interface TechAnalysisProps {
  symbol?: string
  colorTheme?: 'dark' | 'light'
  interval?: '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W' | '1M'
  height?: number
}

export function TechAnalysis({
  symbol = 'BTC/USD',
  colorTheme = 'dark',
  interval = '1h',
  height = 300,
}: TechAnalysisProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const tvSymbol = SYMBOL_MAP[symbol] || 'BINANCE:BTCUSDT'

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      interval,
      width: '100%',
      isTransparent: true,
      height,
      symbol: tvSymbol,
      showIntervalTabs: true,
      displayMode: 'single',
      locale: 'en',
      colorTheme,
    })

    const div = document.createElement('div')
    div.className = 'tradingview-widget-container__widget'
    containerRef.current.appendChild(div)
    containerRef.current.appendChild(script)
  }, [symbol, colorTheme, interval, height])

  return (
    <div className="tradingview-widget-container" ref={containerRef} />
  )
}
