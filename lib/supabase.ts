import { createBrowserClient, createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Browser client — use in Client Components */
export function createBrowserSupabase() {
  return createBrowserClient(url, anon)
}

/** Server client (cookie-based) — use in Server Components, actions, middleware */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(url, anon, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options as any))
        } catch { /* called from Server Component — read-only */ }
      },
    },
  })
}

/** Service role client — use in API routes / crons only */
export function createServiceSupabase() {
  return createClient(url, svc, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Singleton browser client for use in stores/hooks */
let _browser: ReturnType<typeof createBrowserSupabase> | null = null
export function getBrowserSupabase() {
  if (!_browser) _browser = createBrowserSupabase()
  return _browser
}
