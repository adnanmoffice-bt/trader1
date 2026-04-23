'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useEffect, useRef, useState } from 'react'

type NavItem = { href: string; label: string; icon: string }
type NavGroup = { label: string; icon: string; items: NavItem[] }

const PRIMARY: NavItem[] = [
  { href: '/', label: 'TERMINAL', icon: '◉' },
  { href: '/war-room', label: 'WAR ROOM', icon: '⬡' },
  { href: '/signals', label: 'SIGNALS', icon: '◈' },
  { href: '/analytics', label: 'ANALYTICS', icon: '◪' },
  { href: '/journal', label: 'JOURNAL', icon: '☰' },
]

const GROUPS: NavGroup[] = [
  {
    label: 'CHARTS',
    icon: '◫',
    items: [
      { href: '/multi-chart', label: 'Multi-Chart', icon: '◫' },
      { href: '/heatmap', label: 'Heatmap', icon: '▦' },
      { href: '/screener', label: 'Screener', icon: '▤' },
      { href: '/calendar', label: 'Calendar', icon: '▣' },
    ],
  },
  {
    label: 'LAB',
    icon: '▹',
    items: [
      { href: '/simulation', label: 'Simulation', icon: '▹' },
      { href: '/ai-log', label: 'AI Log', icon: '◎' },
      { href: '/polymarket-page', label: 'Polymarket', icon: '◇' },
    ],
  },
]

export function NavBar() {
  const path = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const [user, setUser] = useState<{ name: string } | null>(null)
  const [clock, setClock] = useState('')
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const navRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user) }).catch(() => {})
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenGroup(null)
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpenGroup(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  useEffect(() => { setOpenGroup(null) }, [path])

  const isActive = (href: string) => path === href || (href !== '/' && path.startsWith(href))
  const groupActive = (g: NavGroup) => g.items.some(i => isActive(i.href))

  return (
    <nav ref={navRef} className="flex items-center h-9 px-2 gap-0 flex-shrink-0 relative" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
      {/* Logo */}
      <div className="flex items-center gap-1.5 mr-3 pl-1">
        <span className="font-black text-[12px] tracking-[-0.5px]" style={{ color: 'var(--amber)' }}>APEX</span>
        <span className="text-[7px] font-black px-1.5 py-0.5 rounded-sm animate-pulse" style={{ background: 'var(--green)', color: '#000', letterSpacing: '0.5px' }}>LIVE</span>
      </div>

      {/* Primary Nav Links */}
      <div className="flex items-center gap-0">
        {PRIMARY.map(n => {
          const active = isActive(n.href)
          return (
            <a key={n.href} href={n.href} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold transition-all whitespace-nowrap rounded-sm mx-px" style={{
              color: active ? 'var(--amber)' : 'var(--text-2)',
              background: active ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
              borderBottom: active ? '2px solid var(--amber)' : '2px solid transparent',
            }}>
              <span className="text-[9px] opacity-60">{n.icon}</span>
              {n.label}
            </a>
          )
        })}

        {/* Group dropdowns */}
        {GROUPS.map(g => {
          const active = groupActive(g)
          const open = openGroup === g.label
          return (
            <div key={g.label} className="relative">
              <button
                onClick={() => setOpenGroup(open ? null : g.label)}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold transition-all whitespace-nowrap rounded-sm mx-px"
                style={{
                  color: active || open ? 'var(--amber)' : 'var(--text-2)',
                  background: active || open ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                  borderBottom: active ? '2px solid var(--amber)' : '2px solid transparent',
                }}
                aria-expanded={open}
                aria-haspopup="menu"
              >
                <span className="text-[9px] opacity-60">{g.icon}</span>
                {g.label}
                <span className="text-[8px] ml-0.5 opacity-70" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
              </button>
              {open && (
                <div role="menu" className="absolute left-0 top-full mt-0.5 min-w-[160px] py-1 rounded-sm shadow-lg z-50" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  {g.items.map(item => {
                    const itemActive = isActive(item.href)
                    return (
                      <a key={item.href} href={item.href} role="menuitem" className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold transition-colors" style={{
                        color: itemActive ? 'var(--amber)' : 'var(--text-2)',
                        background: itemActive ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                      }}
                      onMouseEnter={e => { if (!itemActive) e.currentTarget.style.background = 'var(--bg-2)' }}
                      onMouseLeave={e => { if (!itemActive) e.currentTarget.style.background = 'transparent' }}
                      >
                        <span className="text-[10px] opacity-60 w-3">{item.icon}</span>
                        {item.label}
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex-1" />

      {/* Right Controls */}
      <div className="flex items-center gap-1">
        <a href="/investor" className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}>INV</a>
        <a href="/settings" className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}>⚙ SET</a>
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />
        <button onClick={toggle} className="text-[10px] px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-2)' }}>
          {theme === 'light' ? '☀' : '☾'}
        </button>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-sm" style={{ background: 'var(--bg-2)' }}>
          <span className="text-[9px] font-black tabular-nums" style={{ color: 'var(--cyan)' }}>{clock}</span>
          <span className="text-[7px] font-bold" style={{ color: 'var(--text-3)' }}>UAE</span>
        </div>
        {user && <span className="text-[9px] font-bold ml-1" style={{ color: 'var(--text-2)' }}>{user.name}</span>}
        <button onClick={() => { fetch('/api/auth/logout', { method: 'POST' }).then(() => { router.push('/login'); router.refresh() }) }}
          className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm transition-colors hover:bg-[rgba(239,68,68,0.15)]" style={{ color: 'var(--red)' }}>
          EXIT
        </button>
      </div>
    </nav>
  )
}
