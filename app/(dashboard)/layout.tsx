import { createServerSupabase } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { NavBar } from '@/components/NavBar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-primary)' }}>
      <NavBar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
