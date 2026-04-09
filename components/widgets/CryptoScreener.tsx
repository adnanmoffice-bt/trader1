'use client'
import { useEffect, useRef } from 'react'

interface CryptoScreenerProps {
  colorTheme?: 'dark' | 'light'
  height?: string
}

export function CryptoScreener({
  colorTheme = 'dark',
  height = '100%',
}: CryptoScreenerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-screener.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      width: '100%',
      height,
      defaultColumn: 'overview',
      screener_type: 'crypto_mkt',
      displayCurrency: 'USD',
      colorTheme,
      locale: 'en',
      isTransparent: true,
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
