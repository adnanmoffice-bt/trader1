import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Browser client — use in Client Components */
export function createBrowserSupabase() {
  return createBrowserClient(url, anon)
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
