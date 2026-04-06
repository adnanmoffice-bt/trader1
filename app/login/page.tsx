'use client'
import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#03030a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-[#e2e2f5] tracking-tight">APEX</h1>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="w-2 h-2 rounded-full bg-[#00ffa3] animate-pulse" />
            <span className="text-[10px] font-bold text-[#00ffa3] tracking-[0.2em]">AI TRADING TERMINAL</span>
          </div>
        </div>

        <form onSubmit={handleLogin} className="bg-[#07070f] border border-[#1a1a2e] rounded-xl p-6">
          <div className="mb-4">
            <label className="block text-[10px] font-bold text-[#44446a] tracking-wider mb-1.5">EMAIL</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg px-3 py-2.5 text-sm text-[#e2e2f5] placeholder-[#44446a] focus:border-[#00ccff] focus:outline-none transition-colors"
              placeholder="your@email.com" required autoFocus
            />
          </div>

          <div className="mb-6">
            <label className="block text-[10px] font-bold text-[#44446a] tracking-wider mb-1.5">PASSWORD</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg px-3 py-2.5 text-sm text-[#e2e2f5] placeholder-[#44446a] focus:border-[#00ccff] focus:outline-none transition-colors"
              placeholder="********" required
            />
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-[rgba(255,51,102,0.08)] border border-[rgba(255,51,102,0.2)] rounded-lg text-[11px] text-[#ff3366]">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-[#00ccff] text-[#03030a] font-bold text-sm rounded-lg hover:bg-[#00bbee] transition-colors disabled:opacity-50"
          >
            {loading ? 'Prijava...' : 'Prijavi se'}
          </button>

          
        </form>

        <div className="mt-6 text-center text-[9px] text-[#44446a]">
          Secured by Supabase Auth + 2FA
        </div>
      </div>
    </div>
  )
}
