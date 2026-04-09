'use client'
import { useEffect, useRef } from 'react'

interface MarketOverviewProps {
  colorTheme?: 'dark' | 'light'
  height?: string
}

export function MarketOverview({
  colorTheme = 'dark',
  height = '100%',
}: MarketOverviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      colorTheme,
      dateRange: '1D',
      showChart: true,
      locale: 'en',
      width: '100%',
      height,
      largeChartUrl: '',
      isTransparent: true,
      showSymbolLogo: true,
      showFloatingTooltip: true,
      tabs: [
        {
          title: 'Crypto',
          symbols: [
            { s: 'BINANCE:BTCUSDT', d: 'Bitcoin' },
            { s: 'BINANCE:ETHUSDT', d: 'Ethereum' },
            { s: 'BINANCE:SOLUSDT', d: 'Solana' },
            { s: 'BINANCE:BNBUSDT', d: 'BNB' },
            { s: 'BINANCE:DOGEUSDT', d: 'Dogecoin' },
            { s: 'BINANCE:AVAXUSDT', d: 'Avalanche' },
          ],
          originalTitle: 'Crypto',
        },
        {
          title: 'Indices',
          symbols: [
            { s: 'AMEX:SPY', d: 'S&P 500' },
            { s: 'NASDAQ:QQQ', d: 'NASDAQ 100' },
            { s: 'TVC:DJI', d: 'Dow Jones' },
            { s: 'TVC:DXY', d: 'US Dollar' },
          ],
          originalTitle: 'Indices',
        },
        {
          title: 'Commodities',
          symbols: [
            { s: 'TVC:GOLD', d: 'Gold' },
            { s: 'TVC:SILVER', d: 'Silver' },
            { s: 'NYMEX:CL1!', d: 'Crude Oil' },
          ],
          originalTitle: 'Commodities',
        },
      ],
    })

    const div = document.createElement('div')
    div.className = 'tradingview-widget-container__widget'
    containerRef.current.appendChild(div)
    containerRef.current.appendChild(script)
  }, [colorTheme, height])

  return (
    <div className="tradingview-widget-container" ref={containerRef} style={{ height, width: '100%' }} />
  )
}
