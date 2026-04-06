'use client'
import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const INVITE_CODE = 'APEX2026'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (invite !== INVITE_CODE) {
      setError('Invalid invite code')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#03030a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-[#07070f] border border-[#1a1a2e] rounded-xl p-6">
            <div className="text-2xl mb-3">&#x2705;</div>
            <h2 className="text-lg font-bold text-[#e2e2f5] mb-2">Registracija uspjesna!</h2>
            <p className="text-[11px] text-[#7878aa] mb-4">Provjeri email za potvrdu, pa se prijavi.</p>
            <a href="/login" className="inline-block px-4 py-2 bg-[#00ccff] text-[#03030a] font-bold text-sm rounded-lg">
              Na login
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#03030a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-[#e2e2f5] tracking-tight">APEX</h1>
          <p className="text-[10px] text-[#44446a] mt-1 tracking-wider">INVESTOR REGISTRATION</p>
        </div>

        <form onSubmit={handleRegister} className="bg-[#07070f] border border-[#1a1a2e] rounded-xl p-6">
          <div className="mb-4">
            <label className="block text-[10px] font-bold text-[#44446a] tracking-wider mb-1.5">FULL NAME</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg px-3 py-2.5 text-sm text-[#e2e2f5] placeholder-[#44446a] focus:border-[#00ccff] focus:outline-none"
              placeholder="Tvoje ime" required autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-[10px] font-bold text-[#44446a] tracking-wider mb-1.5">EMAIL</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg px-3 py-2.5 text-sm text-[#e2e2f5] placeholder-[#44446a] focus:border-[#00ccff] focus:outline-none"
              placeholder="your@email.com" required
            />
          </div>

          <div className="mb-4">
            <label className="block text-[10px] font-bold text-[#44446a] tracking-wider mb-1.5">PASSWORD</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg px-3 py-2.5 text-sm text-[#e2e2f5] placeholder-[#44446a] focus:border-[#00ccff] focus:outline-none"
              placeholder="Min 8 znakova" required
            />
          </div>

          <div className="mb-6">
            <label className="block text-[10px] font-bold text-[#44446a] tracking-wider mb-1.5">INVITE CODE</label>
            <input
              type="text" value={invite} onChange={e => setInvite(e.target.value)}
              className="w-full bg-[#0f0f1e] border border-[#1a1a2e] rounded-lg px-3 py-2.5 text-sm text-[#e2e2f5] placeholder-[#44446a] focus:border-[#00ccff] focus:outline-none"
              placeholder="Unesi invite code" required
            />
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-[rgba(255,51,102,0.08)] border border-[rgba(255,51,102,0.2)] rounded-lg text-[11px] text-[#ff3366]">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-[#00ffa3] text-[#03030a] font-bold text-sm rounded-lg hover:bg-[#00ee99] transition-colors disabled:opacity-50"
          >
            {loading ? 'Registracija...' : 'Registruj se'}
          </button>

          <div className="mt-4 text-center">
            <a href="/login" className="text-[11px] text-[#44446a] hover:text-[#00ccff] transition-colors">
              Vec imas racun? Prijavi se
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}
