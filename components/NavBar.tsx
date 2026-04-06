'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useEffect, useState } from 'react'

const NAV = [
  { href: '/', label: 'DASHBOARD' },
  { href: '/war-room', label: 'WAR ROOM' },
  { href: '/signals', label: 'SIGNALS' },
  { href: '/simulation', label: 'SIMULATION' },
  { href: '/ai-log', label: 'AI LOG' },
  { href: '/polymarket-page', label: 'POLYMARKET' },
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
    <nav className="flex items-center h-8 px-2 gap-0 flex-shrink-0" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
      <span className="font-black text-[11px] tracking-tight mr-1" style={{ color: 'var(--amber)' }}>APEX</span>
      <span className="text-[8px] font-bold px-1 py-0.5 rounded mr-3" style={{ background: 'var(--green)', color: '#000' }}>LIVE</span>

      {NAV.map(n => {
        const active = path === n.href || (n.href !== '/' && path.startsWith(n.href))
        return (
          <a key={n.href} href={n.href} className="px-2 py-0.5 text-[10px] font-bold transition-colors" style={{
            color: active ? 'var(--amber)' : 'var(--text-2)',
            background: active ? 'var(--bg-2)' : 'transparent',
            borderBottom: active ? '2px solid var(--amber)' : '2px solid transparent',
          }}>{n.label}</a>
        )
      })}

      <div className="flex-1" />

      <a href="/investor" className="text-[9px] px-1.5" style={{ color: 'var(--text-3)' }}>INVESTOR</a>
      <a href="/settings" className="text-[9px] px-1.5" style={{ color: 'var(--text-3)' }}>SETTINGS</a>
      <button onClick={toggle} className="text-[9px] px-1 mx-1" style={{ color: 'var(--text-2)' }}>{theme === 'light' ? 'DARK' : 'LIGHT'}</button>
      <span className="text-[10px] font-bold mx-1" style={{ color: 'var(--cyan)' }}>{clock}</span>
      {user && <span className="text-[9px] mx-1" style={{ color: 'var(--text-2)' }}>{user.name}</span>}
      <button onClick={() => { fetch('/api/auth/logout', { method: 'POST' }).then(() => { router.push('/login'); router.refresh() }) }} className="text-[9px] px-1" style={{ color: 'var(--text-3)' }}>EXIT</button>
    </nav>
  )
}
