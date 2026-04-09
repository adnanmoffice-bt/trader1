'use client'
import { useEffect, useRef } from 'react'

interface CryptoHeatmapProps {
  colorTheme?: 'dark' | 'light'
  hasTopBar?: boolean
  height?: string
}

export function CryptoHeatmap({
  colorTheme = 'dark',
  hasTopBar = true,
  height = '100%',
}: CryptoHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-crypto-coins-heatmap.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      dataSource: 'Crypto',
      blockSize: 'market_cap_calc',
      blockColor: 'change',
      locale: 'en',
      symbolUrl: '',
      colorTheme,
      hasTopBar,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      width: '100%',
      height,
    })

    const div = document.createElement('div')
    div.className = 'tradingview-widget-container__widget'
    containerRef.current.appendChild(div)
    containerRef.current.appendChild(script)
  }, [colorTheme, hasTopBar, height])

  return (
    <div className="tradingview-widget-container" ref={containerRef} style={{ height, width: '100%' }} />
  )
}
