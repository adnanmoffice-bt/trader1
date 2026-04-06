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
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-[#0f172a] tracking-tight">APEX</h1>
          <p className="text-sm text-[#64748b] mt-1">AI Trading Terminal</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white border border-[#e2e8f0] rounded-xl p-6 shadow-sm">
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#64748b] mb-1.5">EMAIL</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#f8f9fb] border border-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] focus:outline-none transition-all"
              placeholder="your@email.com" required autoFocus
            />
          </div>
          <div className="mb-6">
            <label className="block text-[11px] font-semibold text-[#64748b] mb-1.5">PASSWORD</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#f8f9fb] border border-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] focus:outline-none transition-all"
              placeholder="********" required
            />
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-600">{error}</div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-[#0f172a] text-white font-semibold text-sm rounded-lg hover:bg-[#1e293b] transition-colors disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-[10px] text-[#94a3b8]">Secured by Supabase Auth</p>
      </div>
    </div>
  )
}
