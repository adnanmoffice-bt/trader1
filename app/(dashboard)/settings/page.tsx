'use client'
import { useEffect, useState } from 'react'
import { useTheme } from '@/lib/theme'
import { useRouter } from 'next/navigation'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

export default function SettingsPage() {
  const { theme, toggle } = useTheme()
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null)
  const [safety, setSafety] = useState<Record<string, unknown> | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user); else router.push('/login') }).catch(() => {})
    fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="flex items-center justify-between px-6 h-14 border-b border-[var(--border)]" style={{ background: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-4">
          <a href="/" className="text-lg font-black text-[var(--text-primary)]">APEX</a>
          <span className="text-[11px] text-[var(--text-muted)]">Settings</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-[11px] text-[var(--blue)] hover:underline">Back to Terminal</a>
          <a href="/investor" className="text-[11px] text-[var(--text-muted)] hover:text-[var(--blue)]">Investor View</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Profile */}
        <section className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
          <div className="px-5 py-3 border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Profile</h2>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--text-secondary)]">Name</span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">{user?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--text-secondary)]">Email</span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">{user?.email ?? '—'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--text-secondary)]">User ID</span>
              <span className="text-[10px] mono text-[var(--text-muted)]">{user?.id ?? '—'}</span>
            </div>
            <div className="pt-2">
              <button onClick={handleLogout} className="text-sm text-[var(--red)] hover:underline">Sign Out</button>
            </div>
          </div>
        </section>

        {/* Theme */}
        <section className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
          <div className="px-5 py-3 border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Appearance</h2>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Theme</div>
                <div className="text-[11px] text-[var(--text-secondary)]">Switch between light and dark mode</div>
              </div>
              <button onClick={toggle} className={cn(
                'px-4 py-2 text-sm font-semibold rounded-lg border transition-colors',
                theme === 'light' ? 'bg-[#0f172a] text-white border-[#0f172a]' : 'bg-white text-[#0f172a] border-[#e2e8f0]'
              )}>
                {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
              </button>
            </div>
          </div>
        </section>

        {/* API Keys Status */}
        <section className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
          <div className="px-5 py-3 border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase">API Connections</h2>
          </div>
          <div className="p-5 space-y-3">
            {[
              { name: 'Anthropic (Claude AI)', status: 'Active', ok: true, desc: 'Powers AI signal generation and market analysis' },
              { name: 'Binance', status: 'Not configured', ok: false, desc: 'Required for live trading — add API keys to .env.local' },
              { name: 'Telegram', status: 'Not configured', ok: false, desc: 'Optional — sends trade alerts to your phone' },
              { name: 'Polymarket', status: 'Paper mode', ok: true, desc: 'Running paper bets — no real money' },
            ].map(api => (
              <div key={api.name} className="flex items-center justify-between py-2 border-b border-[var(--border-light)] last:border-b-0">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{api.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{api.desc}</div>
                </div>
                <span className={cn('text-[10px] font-bold px-2 py-1 rounded',
                  api.ok ? 'bg-green-50 text-[var(--green)]' : 'bg-amber-50 text-[var(--amber)]'
                )}>{api.status}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Safety Limits */}
        <section className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
          <div className="px-5 py-3 border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Safety Limits</h2>
          </div>
          <div className="p-5 space-y-3">
            {[
              { name: 'Max Drawdown', value: '15%', desc: 'Auto kill-switch if portfolio drops 15% from peak' },
              { name: 'Daily Loss Limit', value: '3%', desc: 'Stop trading for the day if losses exceed 3%' },
              { name: 'Max Positions', value: '3', desc: 'Maximum simultaneous open trades' },
              { name: 'Risk Per Trade', value: '2%', desc: 'Maximum capital at risk in any single trade' },
              { name: 'Min Risk:Reward', value: '1.5:1', desc: 'Only take trades with at least 1.5:1 reward-to-risk' },
            ].map(limit => (
              <div key={limit.name} className="flex items-center justify-between py-2 border-b border-[var(--border-light)] last:border-b-0">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{limit.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{limit.desc}</div>
                </div>
                <span className="text-sm font-bold mono text-[var(--text-primary)]">{limit.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Current Safety Status */}
        {safety && (
          <section className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
            <div className="px-5 py-3 border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
              <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase">Current Safety Status</h2>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={cn('w-3 h-3 rounded-full', safety.safe ? 'bg-[var(--green)]' : 'bg-[var(--red)] animate-pulse')} />
                <span className={cn('text-sm font-bold', safety.safe ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                  {safety.safe ? 'All systems OK' : String(safety.reason)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-[var(--text-muted)] text-[10px]">Drawdown</div>
                  <div className="font-bold mono">{(Number(safety.drawdownPct) * 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)] text-[10px]">Today P&L</div>
                  <div className={cn('font-bold mono', Number(safety.todayPnl) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                    {Number(safety.todayPnl) >= 0 ? '+' : ''}{Number(safety.todayPnl).toFixed(0)} AED
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)] text-[10px]">Open Positions</div>
                  <div className="font-bold mono">{Number(safety.openPositions)} / {Number(safety.maxPositions)}</div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
