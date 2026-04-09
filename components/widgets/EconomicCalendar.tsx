'use client'
import { useEffect, useRef } from 'react'

interface EconomicCalendarProps {
  colorTheme?: 'dark' | 'light'
  height?: string
}

export function EconomicCalendar({
  colorTheme = 'dark',
  height = '100%',
}: EconomicCalendarProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      colorTheme,
      isTransparent: true,
      width: '100%',
      height,
      locale: 'en',
      importanceFilter: '-1,0,1',
      countryFilter: 'us,eu,gb,jp,cn,ae',
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
