'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useEffect, useState } from 'react'

const NAV_ITEMS = [
  { href: '/',                label: 'Dashboard' },
  { href: '/signals',        label: 'Signals' },
  { href: '/simulation',     label: 'Simulation' },
  { href: '/ai-log',         label: 'AI Log' },
  { href: '/polymarket-page', label: 'Polymarket' },
]

export function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const [user, setUser] = useState<{ name: string } | null>(null)
  const [clock, setClock] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user) }).catch(() => {})
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="flex items-center h-12 px-4 border-b border-[var(--border)] flex-shrink-0 gap-1" style={{ background: 'var(--bg-panel)' }}>
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4 flex-shrink-0">
        <span className="text-base font-black tracking-tight text-[var(--text-primary)]">APEX</span>
        <span className="flex items-center gap-1 text-[8px] font-bold tracking-[0.15em] px-1.5 py-0.5 rounded text-white" style={{ background: 'var(--green)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE
        </span>
      </div>

      {/* Nav links */}
      <div className="flex items-center gap-0.5 flex-1">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <a key={item.href} href={item.href}
              className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                active
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}>
              {item.label}
            </a>
          )
        })}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 flex-shrink-0 text-[10px]">
        <span className="mono font-bold text-[var(--blue)]">{clock}</span>
        <a href="/investor" className="text-[var(--text-muted)] hover:text-[var(--blue)] transition-colors">Investor View</a>
        <a href="/settings" className="text-[var(--text-muted)] hover:text-[var(--blue)] transition-colors">Settings</a>
        <button onClick={toggle} className="w-7 h-7 flex items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors text-sm">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        {user && (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-secondary)] font-medium">{user.name}</span>
            <button onClick={handleLogout} className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors">Logout</button>
          </div>
        )}
      </div>
    </nav>
  )
}
