'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useEffect, useState } from 'react'

const NAV = [
  { href: '/', label: 'TERMINAL', icon: '◉' },
  { href: '/multi-chart', label: 'CHARTS', icon: '◫' },
  { href: '/analytics', label: 'ANALYTICS', icon: '◪' },
  { href: '/war-room', label: 'WAR ROOM', icon: '⬡' },
  { href: '/signals', label: 'SIGNALS', icon: '◈' },
  { href: '/journal', label: 'JOURNAL', icon: '☰' },
  { href: '/simulation', label: 'SIM', icon: '▹' },
  { href: '/heatmap', label: 'HEAT', icon: '▦' },
  { href: '/screener', label: 'SCREEN', icon: '▤' },
  { href: '/calendar', label: 'CAL', icon: '▣' },
  { href: '/ai-log', label: 'AI', icon: '◎' },
  { href: '/polymarket-page', label: 'POLY', icon: '◇' },
]

export function NavBar() {
  const path = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const [user, setUser] = useState<{ name: string } | null>(null)
  const [clock, setClock] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user) }).catch(() => {})
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <nav className="flex items-center h-9 px-2 gap-0 flex-shrink-0" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
      {/* Logo */}
      <div className="flex items-center gap-1.5 mr-3 pl-1">
        <span className="font-black text-[12px] tracking-[-0.5px]" style={{ color: 'var(--amber)' }}>APEX</span>
        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm animate-pulse" style={{ background: 'var(--green)', color: '#000', letterSpacing: '0.5px' }}>LIVE</span>
      </div>

      {/* Nav Links */}
      <div className="flex items-center gap-0 overflow-x-auto hide-scrollbar">
        {NAV.map(n => {
          const active = path === n.href || (n.href !== '/' && path.startsWith(n.href))
          return (
            <a key={n.href} href={n.href} className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold transition-all whitespace-nowrap rounded-sm mx-px" style={{
              color: active ? 'var(--amber)' : 'var(--text-2)',
              background: active ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
              borderBottom: active ? '2px solid var(--amber)' : '2px solid transparent',
            }}>
              <span className="text-[8px] opacity-60">{n.icon}</span>
              {n.label}
            </a>
          )
        })}
      </div>

      <div className="flex-1" />

      {/* Right Controls */}
      <div className="flex items-center gap-1">
        <a href="/investor" className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}>INV</a>
        <a href="/settings" className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}>⚙ SET</a>
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />
        <button onClick={toggle} className="text-[10px] px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-2)' }}>
          {theme === 'light' ? '☀' : '☾'}
        </button>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-sm" style={{ background: 'var(--bg-2)' }}>
          <span className="text-[9px] font-black tabular-nums" style={{ color: 'var(--cyan)' }}>{clock}</span>
          <span className="text-[7px] font-bold" style={{ color: 'var(--text-3)' }}>UAE</span>
        </div>
        {user && <span className="text-[8px] font-bold ml-1" style={{ color: 'var(--text-2)' }}>{user.name}</span>}
        <button onClick={() => { fetch('/api/auth/logout', { method: 'POST' }).then(() => { router.push('/login'); router.refresh() }) }}
          className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[rgba(239,68,68,0.15)]" style={{ color: 'var(--red)' }}>
          EXIT
        </button>
      </div>
    </nav>
  )
}
