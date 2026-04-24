'use client'
import { useEffect, useState, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { useRouter } from 'next/navigation'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

type ExchangeId = 'binance' | 'bybit' | 'okx' | 'kraken' | 'kucoin' | 'bitget' | 'gateio' | 'mexc'

interface ExchangeMeta {
  id: ExchangeId
  name: string
  logo: string
  website: string
  needsPassphrase: boolean
}

const EXCHANGES: ExchangeMeta[] = [
  { id: 'binance', name: 'Binance', logo: '🟡', website: 'binance.com', needsPassphrase: false },
  { id: 'bybit', name: 'Bybit', logo: '🔶', website: 'bybit.com', needsPassphrase: false },
  { id: 'okx', name: 'OKX', logo: '⚫', website: 'okx.com', needsPassphrase: true },
  { id: 'kraken', name: 'Kraken', logo: '🟣', website: 'kraken.com', needsPassphrase: false },
  { id: 'kucoin', name: 'KuCoin', logo: '🟢', website: 'kucoin.com', needsPassphrase: true },
  { id: 'bitget', name: 'Bitget', logo: '🔵', website: 'bitget.com', needsPassphrase: true },
  { id: 'gateio', name: 'Gate.io', logo: '🔷', website: 'gate.io', needsPassphrase: false },
  { id: 'mexc', name: 'MEXC', logo: '🟦', website: 'mexc.com', needsPassphrase: false },
]

interface Settings {
  trading_mode: string
  primary_exchange: ExchangeId
  binance_api_key_masked?: string
  binance_configured: boolean
  configured_exchanges: { id: ExchangeId; masked_key: string }[]
  telegram_bot_token_masked?: string
  telegram_chat_id?: string
  telegram_configured: boolean
  whatsapp_instance_id?: string
  whatsapp_configured: boolean
  whatsapp_enabled: boolean
  whatsapp_group_id?: string
  whatsapp_group_name?: string
  whatsapp_api_token_set?: boolean
  max_drawdown_pct: number
  daily_loss_limit_pct: number
  max_positions: number
  risk_per_trade_pct: number
  min_risk_reward: number
  max_sl_pct: number
  initial_capital: number
  currency: string
  notifications_enabled: boolean
  auto_trade_enabled: boolean
}

interface WalletAsset { asset: string; free: number; locked: number; total: number }
interface WalletData {
  configured: boolean
  connected: boolean
  balances: WalletAsset[]
  summary: { usdt_free: number; usdt_total: number; btc_total: number; eth_total: number; total_assets: number }
  wallets?: {
    spot: { assets: WalletAsset[]; usdt_free: number; usdt_total: number; count: number }
    funding: { assets: WalletAsset[]; usdt_total: number; count: number; ok: boolean }
    earn_flexible: { assets: WalletAsset[]; usdt_total: number; count: number; ok: boolean }
  }
  permissions: { can_trade: boolean; can_withdraw: boolean }
}

interface SafetyData {
  safe: boolean
  killSwitchActive: boolean
  drawdownPct: number
  dailyLossPct: number
  openPositions: number
  maxPositions: number
  peakCapital: number
  currentCapital: number
  todayPnl: number
  reason?: string
}

// All values displayed in USD

function Section({ title, icon, children, badge }: { title: string; icon: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between" style={{ background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase">{title}</h2>
        </div>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={cn('w-2 h-2 rounded-full inline-block', ok ? 'bg-[var(--green)]' : 'bg-[var(--red)] animate-pulse')} />
}

function Badge({ text, ok }: { text: string; ok: boolean }) {
  return (
    <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full',
      ok ? 'text-[var(--green)] border border-[var(--green)]' : 'text-[var(--amber)] border border-[var(--amber)]'
    )} style={{ background: ok ? 'rgba(0,255,163,0.08)' : 'rgba(255,204,0,0.08)' }}>
      {text}
    </span>
  )
}

export default function SettingsPage() {
  const { theme, toggle } = useTheme()
  const router = useRouter()
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [safety, setSafety] = useState<SafetyData | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [walletLoading, setWalletLoading] = useState(false)

  // Exchange form
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>('binance')
  const [apiKey, setApiKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; warning?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  // Telegram form
  const [tgToken, setTgToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')

  // WhatsApp form
  const [waInstanceId, setWaInstanceId] = useState('')
  const [waApiToken, setWaApiToken] = useState('')
  const [waTestResult, setWaTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [waTesting, setWaTesting] = useState(false)
  const [waGroups, setWaGroups] = useState<{ id: string; name: string }[]>([])
  const [waGroupsLoading, setWaGroupsLoading] = useState(false)
  const [waSelectedGroup, setWaSelectedGroup] = useState('')

  // Risk form
  const [riskForm, setRiskForm] = useState({
    max_drawdown_pct: 15,
    daily_loss_limit_pct: 3,
    max_positions: 3,
    risk_per_trade_pct: 2,
    min_risk_reward: 1.5,
    max_sl_pct: 6,
    initial_capital: 5000,
  })

  const loadSettings = useCallback(async () => {
    const res = await fetch('/api/settings')
    const data = await res.json()
    if (data.settings) {
      setSettings(data.settings)
      setRiskForm({
        max_drawdown_pct: data.settings.max_drawdown_pct,
        daily_loss_limit_pct: data.settings.daily_loss_limit_pct,
        max_positions: data.settings.max_positions,
        risk_per_trade_pct: data.settings.risk_per_trade_pct,
        min_risk_reward: data.settings.min_risk_reward,
        max_sl_pct: data.settings.max_sl_pct,
        initial_capital: data.settings.initial_capital,
      })
      if (data.settings.telegram_chat_id) setTgChatId(data.settings.telegram_chat_id)
    }
  }, [])

  const loadWallet = useCallback(async () => {
    setWalletLoading(true)
    try {
      const res = await fetch('/api/wallet')
      const data = await res.json()
      if (data.connected) setWallet(data)
    } catch { /* ignore */ }
    setWalletLoading(false)
  }, [])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user); else router.push('/login') }).catch(() => {})
    fetch('/api/safety').then(r => r.json()).then(d => { if (d.data) setSafety(d.data) }).catch(() => {})
    loadSettings()
  }, [router, loadSettings])

  useEffect(() => {
    if (settings?.binance_configured || (settings?.configured_exchanges?.length ?? 0) > 0) loadWallet()
  }, [settings?.binance_configured, settings?.configured_exchanges?.length, loadWallet])

  async function saveField(fields: Record<string, unknown>) {
    setSaving(true)
    setSaveMsg('')
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    const data = await res.json()
    if (data.success) {
      setSaveMsg('Saved!')
      await loadSettings()
    } else {
      setSaveMsg(data.error || 'Error')
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  const currentExMeta = EXCHANGES.find(e => e.id === selectedExchange)!

  async function testExchange() {
    if (!apiKey || !secretKey) { setTestResult({ success: false, message: 'Enter both keys' }); return }
    if (currentExMeta.needsPassphrase && !passphrase) { setTestResult({ success: false, message: 'Enter Passphrase' }); return }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/settings/test-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange: selectedExchange, apiKey, secretKey, passphrase: passphrase || undefined }),
      })
      const data = await res.json()
      if (data.success) {
        setTestResult({
          success: true,
          message: `${data.exchangeName} connected! ${data.quoteAsset}: $${data.quoteBalance.toFixed(2)} | Trading: ${data.canTrade ? 'YES' : 'NO'}`,
          warning: data.warning,
        })
      } else {
        setTestResult({ success: false, message: data.error })
      }
    } catch {
      setTestResult({ success: false, message: 'Testing error' })
    }
    setTesting(false)
  }

  async function saveExchangeKeys() {
    if (selectedExchange === 'binance') {
      await saveField({ binance_api_key: apiKey, binance_secret_key: secretKey })
    } else {
      await saveField({
        [`exchange_${selectedExchange}_api_key`]: apiKey,
        [`exchange_${selectedExchange}_secret_key`]: secretKey,
        ...(passphrase ? { [`exchange_${selectedExchange}_passphrase`]: passphrase } : {}),
      })
    }
    setApiKey('')
    setSecretKey('')
    setPassphrase('')
    loadWallet()
  }

  async function setPrimaryExchange(id: ExchangeId) {
    await saveField({ primary_exchange: id })
  }

  const anyExchangeConfigured = (settings?.configured_exchanges?.length ?? 0) > 0 || settings?.binance_configured

  async function toggleTradingMode() {
    const newMode = settings?.trading_mode === 'live' ? 'demo' : 'live'
    if (newMode === 'live' && !anyExchangeConfigured) {
      setSaveMsg('Configure at least one exchange first!')
      setTimeout(() => setSaveMsg(''), 3000)
      return
    }
    if (newMode === 'live' && !confirm('WARNING: You are switching to LIVE trading with real money. Continue?')) return
    await saveField({ trading_mode: newMode })
  }

  async function handleKillSwitch(action: 'activate' | 'deactivate') {
    if (action === 'activate' && !confirm('KILL SWITCH will stop ALL trading for 24h. Continue?')) return
    await fetch('/api/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const res = await fetch('/api/safety')
    const data = await res.json()
    if (data.data) setSafety(data.data)
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  async function testWhatsApp() {
    const instId = waInstanceId || settings?.whatsapp_instance_id || ''
    if (!instId || !waApiToken) { setWaTestResult({ success: false, message: 'Enter Instance ID and API Token' }); return }
    setWaTesting(true)
    setWaTestResult(null)
    try {
      const res = await fetch('/api/settings/test-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: instId, apiToken: waApiToken, action: 'test-connection' }),
      })
      const data = await res.json()
      if (data.success) {
        setWaTestResult({ success: true, message: `Connected! Phone: +${data.phone}` })
      } else {
        setWaTestResult({ success: false, message: data.error || 'Error' })
      }
    } catch {
      setWaTestResult({ success: false, message: 'Testing error' })
    }
    setWaTesting(false)
  }

  async function loadWaGroups() {
    const instId = waInstanceId || settings?.whatsapp_instance_id || ''
    if (!instId || !waApiToken) return
    setWaGroupsLoading(true)
    try {
      const res = await fetch('/api/whatsapp/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: instId, apiToken: waApiToken }),
      })
      const data = await res.json()
      setWaGroups(data.groups ?? [])
    } catch { setWaGroups([]) }
    setWaGroupsLoading(false)
  }

  async function saveWhatsApp() {
    const instId = waInstanceId || settings?.whatsapp_instance_id
    const groupId = waSelectedGroup || settings?.whatsapp_group_id
    if (!waApiToken) {
      setWaTestResult({ success: false, message: 'Enter API Token before saving!' })
      return
    }
    const groupName = waGroups.find(g => g.id === waSelectedGroup)?.name
    await saveField({
      whatsapp_instance_id: instId,
      whatsapp_api_token: waApiToken,
      whatsapp_group_id: groupId,
      whatsapp_group_name: groupName || undefined,
      whatsapp_enabled: true,
    })
    setWaTestResult({ success: true, message: 'WhatsApp configuration saved! Token is in database.' })
  }

  async function sendTestWaMessage() {
    const instId = waInstanceId || settings?.whatsapp_instance_id || ''
    const token = waApiToken
    const groupId = waSelectedGroup || settings?.whatsapp_group_id || ''
    if (!instId || !groupId) { setWaTestResult({ success: false, message: 'Save configuration first (Instance ID + Group)' }); return }
    if (!token) { setWaTestResult({ success: false, message: 'Enter API Token to send test message' }); return }
    setWaTesting(true)
    try {
      const res = await fetch('/api/settings/test-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: instId, apiToken: token, groupId, action: 'test-message' }),
      })
      const data = await res.json()
      setWaTestResult({ success: data.success, message: data.success ? 'Test message sent to group!' : (data.error || 'Error') })
    } catch {
      setWaTestResult({ success: false, message: 'Error' })
    }
    setWaTesting(false)
  }

  const isLive = settings?.trading_mode === 'live'

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--border)]" style={{ background: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-4">
          <a href="/" className="text-lg font-black" style={{ color: 'var(--amber)' }}>APEX</a>
          <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-wider">SETTINGS</span>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={cn('text-[11px] font-bold px-3 py-1 rounded-full animate-pulse',
              saveMsg === 'Saved!' ? 'text-[var(--green)] bg-[rgba(0,255,163,0.1)]' : 'text-[var(--red)] bg-[rgba(255,51,102,0.1)]'
            )}>{saveMsg}</span>
          )}
          <a href="/" className="text-[11px] font-bold px-3 py-1 rounded" style={{ color: 'var(--cyan)', border: '1px solid var(--cyan)' }}>TERMINAL</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-5">

        {/* ─── TRADING MODE ──────────────────────────────────────────── */}
        <Section title="Trading Mode" icon="⚡"
          badge={<Badge text={isLive ? 'LIVE' : 'DEMO'} ok={!isLive} />}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {isLive ? 'LIVE — Real money' : 'DEMO — Simulation'}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {isLive
                  ? `AI trades on ${EXCHANGES.find(e => e.id === settings?.primary_exchange)?.name || 'exchange'} with real funds`
                  : `Virtual capital: $${riskForm.initial_capital.toLocaleString()}`
                }
              </div>
            </div>
            <button
              onClick={toggleTradingMode}
              disabled={saving}
              className={cn(
                'px-5 py-2.5 text-sm font-black rounded-lg transition-all',
                isLive
                  ? 'border-2 border-[var(--green)] text-[var(--green)] hover:bg-[rgba(0,255,163,0.1)]'
                  : 'border-2 border-[var(--amber)] text-[var(--amber)] hover:bg-[rgba(255,204,0,0.1)]'
              )}
            >
              {isLive ? 'SWITCH TO DEMO' : 'SWITCH TO LIVE'}
            </button>
          </div>
          {isLive && (
            <div className="mt-3 p-3 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(255,51,102,0.08)', color: 'var(--red)', border: '1px solid var(--red)' }}>
              WARNING: AI signals are executed with real money on {EXCHANGES.find(e => e.id === settings?.primary_exchange)?.name || 'the exchange'}. Kill switch below.
            </div>
          )}
        </Section>

        {/* ─── EXCHANGE CONNECTIONS ─────────────────────────────────── */}
        <Section title="Exchange Connections" icon="🏦"
          badge={<Badge text={anyExchangeConfigured ? `${(settings?.configured_exchanges?.length ?? 0) + (settings?.binance_configured ? 1 : 0)} CONNECTED` : 'NONE'} ok={!!anyExchangeConfigured} />}
        >
          {/* Connected exchanges */}
          {(settings?.binance_configured || (settings?.configured_exchanges?.length ?? 0) > 0) && (
            <div className="mb-4 space-y-2">
              <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--text-muted)' }}>CONNECTED EXCHANGES</div>
              {settings?.binance_configured && (
                <div className="p-2.5 rounded-lg flex items-center justify-between" style={{ background: 'rgba(0,255,163,0.06)', border: '1px solid rgba(0,255,163,0.15)' }}>
                  <div className="flex items-center gap-2">
                    <StatusDot ok />
                    <span className="text-sm">🟡</span>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--green)' }}>Binance</span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{settings.binance_api_key_masked}</span>
                  </div>
                  <button onClick={() => setPrimaryExchange('binance')}
                    className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full',
                      settings?.primary_exchange === 'binance' ? 'bg-[var(--amber)] text-black' : 'text-[var(--text-muted)]'
                    )} style={settings?.primary_exchange !== 'binance' ? { border: '1px solid var(--border)' } : {}}
                  >
                    {settings?.primary_exchange === 'binance' ? 'PRIMARY' : 'SET AS PRIMARY'}
                  </button>
                </div>
              )}
              {(settings?.configured_exchanges ?? []).map(ex => {
                const meta = EXCHANGES.find(e => e.id === ex.id)
                return (
                  <div key={ex.id} className="p-2.5 rounded-lg flex items-center justify-between" style={{ background: 'rgba(0,255,163,0.06)', border: '1px solid rgba(0,255,163,0.15)' }}>
                    <div className="flex items-center gap-2">
                      <StatusDot ok />
                      <span className="text-sm">{meta?.logo}</span>
                      <span className="text-[11px] font-bold" style={{ color: 'var(--green)' }}>{meta?.name}</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{ex.masked_key}</span>
                    </div>
                    <button onClick={() => setPrimaryExchange(ex.id)}
                      className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full',
                        settings?.primary_exchange === ex.id ? 'bg-[var(--amber)] text-black' : 'text-[var(--text-muted)]'
                      )} style={settings?.primary_exchange !== ex.id ? { border: '1px solid var(--border)' } : {}}
                    >
                      {settings?.primary_exchange === ex.id ? 'PRIMARY' : 'SET AS PRIMARY'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Exchange selector */}
          <div className="mb-3">
            <label className="text-[10px] font-bold block mb-2" style={{ color: 'var(--text-muted)' }}>ADD EXCHANGE</label>
            <div className="grid grid-cols-4 gap-2">
              {EXCHANGES.map(ex => (
                <button key={ex.id} onClick={() => { setSelectedExchange(ex.id); setTestResult(null); setApiKey(''); setSecretKey(''); setPassphrase('') }}
                  className={cn('p-2 rounded-lg text-center transition-all',
                    selectedExchange === ex.id ? 'ring-2 ring-[var(--amber)]' : ''
                  )}
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                >
                  <div className="text-lg">{ex.logo}</div>
                  <div className="text-[10px] font-bold mt-0.5" style={{ color: selectedExchange === ex.id ? 'var(--amber)' : 'var(--text-primary)' }}>{ex.name}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{currentExMeta.name} API KEY</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder={`Enter ${currentExMeta.name} API Key`}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{currentExMeta.name} SECRET KEY</label>
              <input type="password" value={secretKey} onChange={e => setSecretKey(e.target.value)}
                placeholder={`Enter ${currentExMeta.name} Secret Key`}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            {currentExMeta.needsPassphrase && (
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--amber)' }}>PASSPHRASE (required for {currentExMeta.name})</label>
                <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                  placeholder={`Enter ${currentExMeta.name} Passphrase`}
                  className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--amber)' }}
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={testExchange} disabled={testing || !apiKey || !secretKey}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ border: '1px solid var(--cyan)', color: 'var(--cyan)' }}
              >
                {testing ? 'TESTING...' : `TEST ${currentExMeta.name.toUpperCase()}`}
              </button>
              <button onClick={saveExchangeKeys} disabled={saving || !apiKey || !secretKey}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ background: 'var(--green)', color: '#000' }}
              >
                SAVE KEYS
              </button>
            </div>

            {testResult && (
              <div className={cn('mt-2 p-3 rounded-lg text-[11px] font-bold',
                testResult.success ? 'text-[var(--green)]' : 'text-[var(--red)]'
              )} style={{ background: testResult.success ? 'rgba(0,255,163,0.06)' : 'rgba(255,51,102,0.06)', border: `1px solid ${testResult.success ? 'var(--green)' : 'var(--red)'}` }}>
                {testResult.message}
                {testResult.warning && (
                  <div className="mt-1 text-[var(--amber)]">{testResult.warning}</div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 p-3 rounded-lg text-[10px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
            <strong>Setup:</strong> {currentExMeta.website} → Settings → API Management → Create API
            <br />Enable only <strong>&quot;Enable Spot Trading&quot;</strong>. NEVER enable Withdrawal.
            {currentExMeta.needsPassphrase && <><br /><span style={{ color: 'var(--amber)' }}>⚠️ {currentExMeta.name} requires a Passphrase that is set when creating the API key.</span></>}
          </div>
        </Section>

        {/* ─── WALLET ─────────────────────────────────────────────── */}
        {anyExchangeConfigured && (
          <Section title="Wallet" icon="💰"
            badge={
              <button onClick={loadWallet} disabled={walletLoading}
                className="text-[9px] font-bold px-2 py-0.5 rounded"
                style={{ color: 'var(--cyan)', border: '1px solid var(--cyan)' }}
              >
                {walletLoading ? 'LOADING...' : 'REFRESH'}
              </button>
            }
          >
            {wallet ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>USDT TRADABLE</div>
                    <div className="text-xl font-black mt-1" style={{ color: 'var(--green)' }}>
                      ${wallet.summary.usdt_free.toFixed(2)}
                    </div>
                    <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Spot · free for war-room
                    </div>
                  </div>
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>USDT TOTAL</div>
                    <div className="text-xl font-black mt-1" style={{ color: 'var(--cyan)' }}>
                      ${wallet.summary.usdt_total.toFixed(2)}
                    </div>
                    <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      All wallets combined
                    </div>
                  </div>
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>BTC</div>
                    <div className="text-lg font-black mt-1" style={{ color: 'var(--amber)' }}>
                      {wallet.summary.btc_total.toFixed(6)}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>ETH</div>
                    <div className="text-lg font-black mt-1" style={{ color: 'var(--purple)' }}>
                      {wallet.summary.eth_total.toFixed(4)}
                    </div>
                  </div>
                </div>

                {wallet.summary.usdt_free < 10 && wallet.summary.usdt_total > 10 && (
                  <div className="p-2.5 rounded-lg border text-[11px]"
                    style={{ background: 'rgba(255,204,0,0.08)', borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                    ⚠️ Tradable USDT is ${wallet.summary.usdt_free.toFixed(2)} but you hold ${wallet.summary.usdt_total.toFixed(2)} total.
                    Transfer from <strong>Funding</strong> / <strong>Simple Earn</strong> to <strong>Spot</strong> on Binance to let the war-room trade.
                  </div>
                )}

                {wallet.wallets && (
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: 'spot', label: 'SPOT', color: 'var(--green)', w: wallet.wallets.spot },
                      { key: 'funding', label: 'FUNDING', color: 'var(--cyan)', w: wallet.wallets.funding },
                      { key: 'earn_flexible', label: 'SIMPLE EARN', color: 'var(--purple)', w: wallet.wallets.earn_flexible },
                    ] as const).map(({ key, label, color, w }) => (
                      <div key={key} className="p-2.5 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="text-[9px] font-bold" style={{ color }}>{label}</div>
                        <div className="text-sm font-black mt-0.5 font-mono" style={{ color: 'var(--text-primary)' }}>
                          ${(w.usdt_total ?? 0).toFixed(2)}
                        </div>
                        <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {w.count} {w.count === 1 ? 'asset' : 'assets'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {wallet.balances.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--text-muted)' }}>ALL ASSETS ({wallet.summary.total_assets}) · aggregated across wallets</div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {wallet.balances.map(b => (
                        <div key={b.asset} className="flex items-center justify-between py-1 px-2 rounded text-[11px]" style={{ background: 'var(--bg-secondary)' }}>
                          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{b.asset}</span>
                          <div className="flex gap-4">
                            <span style={{ color: 'var(--text-secondary)' }}>Total: <span className="font-mono font-bold">{b.total.toFixed(b.asset === 'USDT' || b.asset === 'USDC' ? 2 : 6)}</span></span>
                            {b.locked > 0 && <span style={{ color: 'var(--amber)' }}>Locked: <span className="font-mono">{b.locked.toFixed(6)}</span></span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4 pt-2 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <StatusDot ok={wallet.permissions.can_trade} />
                    <span style={{ color: 'var(--text-muted)' }}>Spot Trading</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusDot ok={!wallet.permissions.can_withdraw} />
                    <span style={{ color: wallet.permissions.can_withdraw ? 'var(--red)' : 'var(--text-muted)' }}>
                      {wallet.permissions.can_withdraw ? 'Withdrawal ENABLED — disable it!' : 'Withdrawal disabled'}
                    </span>
                  </div>
                </div>
              </div>
            ) : walletLoading ? (
              <div className="text-center py-8 text-[11px]" style={{ color: 'var(--text-muted)' }}>Loading wallet data...</div>
            ) : (
              <div className="text-center py-8 text-[11px]" style={{ color: 'var(--text-muted)' }}>Cannot load — check API keys</div>
            )}
          </Section>
        )}

        {/* ─── RISK CONTROLS ──────────────────────────────────────── */}
        <Section title="Risk Controls" icon="🛡️">
          <div className="space-y-4">
            {[
              { key: 'max_drawdown_pct', label: 'Max Drawdown', unit: '%', min: 5, max: 30, step: 1, desc: 'Kill-switch if portfolio drops below this percentage' },
              { key: 'daily_loss_limit_pct', label: 'Daily Loss Limit', unit: '%', min: 1, max: 10, step: 0.5, desc: 'Stop trading today if losses exceed this' },
              { key: 'max_positions', label: 'Max Open Positions', unit: '', min: 1, max: 10, step: 1, desc: 'How many concurrent trades allowed' },
              { key: 'risk_per_trade_pct', label: 'Risk Per Trade', unit: '%', min: 0.5, max: 5, step: 0.5, desc: 'Maximum capital per single trade' },
              { key: 'min_risk_reward', label: 'Min Risk:Reward', unit: ':1', min: 1, max: 5, step: 0.5, desc: 'Minimum reward-to-risk ratio' },
              { key: 'max_sl_pct', label: 'Max Stop Loss', unit: '%', min: 1, max: 15, step: 1, desc: 'Maximum SL distance from entry price' },
            ].map(field => (
              <div key={field.key} className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{field.label}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{field.desc}</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={riskForm[field.key as keyof typeof riskForm]}
                    onChange={e => setRiskForm(f => ({ ...f, [field.key]: parseFloat(e.target.value) }))}
                    className="w-24 accent-[var(--amber)]"
                  />
                  <span className="text-sm font-black mono w-14 text-right" style={{ color: 'var(--amber)' }}>
                    {riskForm[field.key as keyof typeof riskForm]}{field.unit}
                  </span>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between gap-4 pt-2">
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Initial Capital</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Starting portfolio value in USD</div>
              </div>
              <input
                type="number"
                value={riskForm.initial_capital}
                onChange={e => setRiskForm(f => ({ ...f, initial_capital: parseFloat(e.target.value) || 0 }))}
                className="w-32 px-3 py-1.5 text-sm text-right font-mono font-bold rounded-lg"
                style={{ background: 'var(--bg-secondary)', color: 'var(--amber)', border: '1px solid var(--border)' }}
              />
            </div>

            <div className="pt-3 flex justify-end">
              <button
                onClick={() => saveField(riskForm)}
                disabled={saving}
                className="px-5 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ background: 'var(--green)', color: '#000' }}
              >
                SAVE LIMITS
              </button>
            </div>
          </div>
        </Section>

        {/* ─── TELEGRAM ───────────────────────────────────────────── */}
        <Section title="Telegram Notifications" icon="📱"
          badge={<Badge text={settings?.telegram_configured ? 'ACTIVE' : 'NOT CONFIGURED'} ok={!!settings?.telegram_configured} />}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Notifications</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Sends an alert to your phone for every trade</div>
              </div>
              <button
                onClick={() => saveField({ notifications_enabled: !settings?.notifications_enabled })}
                className={cn('w-12 h-6 rounded-full transition-colors relative',
                  settings?.notifications_enabled ? 'bg-[var(--green)]' : 'bg-[var(--bg-secondary)]'
                )}
                style={{ border: '1px solid var(--border)' }}
              >
                <span className={cn('w-5 h-5 rounded-full absolute top-0.5 transition-all',
                  settings?.notifications_enabled ? 'left-6 bg-black' : 'left-0.5 bg-[var(--text-muted)]'
                )} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>BOT TOKEN</label>
              <input
                type="password"
                value={tgToken}
                onChange={e => setTgToken(e.target.value)}
                placeholder={settings?.telegram_configured ? 'Enter new to change...' : 'Enter Bot Token from @BotFather'}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>CHAT ID</label>
              <input
                type="text"
                value={tgChatId}
                onChange={e => setTgChatId(e.target.value)}
                placeholder="Your Chat ID (send /start to @userinfobot)"
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div className="pt-1">
              <button onClick={() => saveField({ telegram_bot_token: tgToken || undefined, telegram_chat_id: tgChatId || undefined })}
                disabled={saving}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ background: 'var(--green)', color: '#000' }}
              >
                SAVE TELEGRAM
              </button>
            </div>
          </div>
        </Section>

        {/* ─── WHATSAPP ─────────────────────────────────────────────── */}
        <Section title="WhatsApp Group" icon="💬"
          badge={<Badge text={settings?.whatsapp_configured ? 'CONNECTED' : 'NOT CONFIGURED'} ok={!!settings?.whatsapp_configured} />}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>WhatsApp Notifications</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Sends signals, trades and reports to the WhatsApp group</div>
              </div>
              <button
                onClick={() => saveField({ whatsapp_enabled: !settings?.whatsapp_enabled })}
                className={cn('w-12 h-6 rounded-full transition-colors relative',
                  settings?.whatsapp_enabled ? 'bg-[var(--green)]' : 'bg-[var(--bg-secondary)]'
                )}
                style={{ border: '1px solid var(--border)' }}
              >
                <span className={cn('w-5 h-5 rounded-full absolute top-0.5 transition-all',
                  settings?.whatsapp_enabled ? 'left-6 bg-black' : 'left-0.5 bg-[var(--text-muted)]'
                )} />
              </button>
            </div>

            {settings?.whatsapp_configured && (
              <div className="mb-3 p-3 rounded-lg flex items-center gap-3" style={{ background: 'rgba(0,255,163,0.06)', border: '1px solid rgba(0,255,163,0.2)' }}>
                <StatusDot ok />
                <div>
                  <div className="text-[11px] font-bold" style={{ color: 'var(--green)' }}>Green API Connected</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Instance: {settings.whatsapp_instance_id}
                    {settings.whatsapp_group_name && ` | Group: ${settings.whatsapp_group_name}`}
                    {settings.whatsapp_group_id && !settings.whatsapp_group_name && ` | Group: ${settings.whatsapp_group_id}`}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Token: {settings.whatsapp_api_token_set ? '✅ in database' : '❌ NOT SAVED'}
                    {' | '}Enabled: {settings.whatsapp_enabled ? '✅' : '❌ OFF'}
                    {' | '}Group: {settings.whatsapp_group_id ? '✅' : '❌ NONE'}
                  </div>
                </div>
              </div>
            )}
            {!settings?.whatsapp_configured && settings?.whatsapp_instance_id && (
              <div className="mb-3 p-3 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(255,204,0,0.08)', color: 'var(--amber)', border: '1px solid var(--amber)' }}>
                Instance ID exists but API Token is MISSING from database. Enter token and click Save.
              </div>
            )}

            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>INSTANCE ID</label>
              <input
                type="text"
                value={waInstanceId}
                onChange={e => setWaInstanceId(e.target.value)}
                placeholder={settings?.whatsapp_instance_id || 'e.g. 7107578215'}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>API TOKEN</label>
              <input
                type="password"
                value={waApiToken}
                onChange={e => setWaApiToken(e.target.value)}
                placeholder={settings?.whatsapp_configured ? 'Enter new to change...' : 'Enter API Token from Green API'}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={testWhatsApp} disabled={waTesting || !waApiToken}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ border: '1px solid var(--cyan)', color: 'var(--cyan)' }}
              >
                {waTesting ? 'TESTING...' : 'TEST CONNECTION'}
              </button>
              <button onClick={loadWaGroups} disabled={waGroupsLoading || !waApiToken}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ border: '1px solid var(--amber)', color: 'var(--amber)' }}
              >
                {waGroupsLoading ? 'LOADING...' : 'LOAD GROUPS'}
              </button>
            </div>

            {waGroups.length > 0 && (
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>SELECT GROUP</label>
                <select
                  value={waSelectedGroup || settings?.whatsapp_group_id || ''}
                  onChange={e => setWaSelectedGroup(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                >
                  <option value="">— Select a group —</option>
                  {waGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            {waTestResult && (
              <div className={cn('p-3 rounded-lg text-[11px] font-bold',
                waTestResult.success ? 'text-[var(--green)]' : 'text-[var(--red)]'
              )} style={{ background: waTestResult.success ? 'rgba(0,255,163,0.06)' : 'rgba(255,51,102,0.06)', border: `1px solid ${waTestResult.success ? 'var(--green)' : 'var(--red)'}` }}>
                {waTestResult.message}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={saveWhatsApp} disabled={saving || !waApiToken}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ background: 'var(--green)', color: '#000' }}
              >
                SAVE WHATSAPP
              </button>
              {(waSelectedGroup || settings?.whatsapp_group_id) && waApiToken && (
                <button onClick={sendTestWaMessage} disabled={waTesting}
                  className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                  style={{ border: '1px solid var(--purple)', color: 'var(--purple)' }}
                >
                  SEND TEST MESSAGE
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 p-3 rounded-lg text-[10px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
            <strong>Setup:</strong> green-api.com → Create instance → Scan QR → Copy Instance ID + API Token
          </div>
        </Section>

        {/* ─── SAFETY STATUS + KILL SWITCH ─────────────────────────── */}
        <Section title="Safety Status" icon="🚨"
          badge={safety && <Badge text={safety.safe ? 'ALL OK' : 'WARNING'} ok={safety.safe} />}
        >
          {safety ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className={cn('w-4 h-4 rounded-full', safety.safe ? 'bg-[var(--green)]' : 'bg-[var(--red)] animate-pulse')} />
                <span className={cn('text-sm font-bold', safety.safe ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                  {safety.safe ? 'All systems OK' : (safety.reason || 'Problem detected')}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Drawdown', value: `${(safety.drawdownPct * 100).toFixed(1)}%`, ok: safety.drawdownPct < 0.15 },
                  { label: "Today's P&L", value: `${safety.todayPnl >= 0 ? '+' : ''}$${safety.todayPnl.toFixed(0)}`, ok: safety.todayPnl >= 0 },
                  { label: 'Open Positions', value: `${safety.openPositions} / ${safety.maxPositions}`, ok: safety.openPositions < safety.maxPositions },
                  { label: 'Capital', value: `$${safety.currentCapital.toLocaleString()}`, ok: true },
                ].map(s => (
                  <div key={s.label} className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                    <div className={cn('text-sm font-black mono mt-1', s.ok ? 'text-[var(--text-primary)]' : 'text-[var(--red)]')}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold" style={{ color: 'var(--red)' }}>Kill Switch</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {safety.killSwitchActive
                        ? 'ACTIVE — all trading is stopped'
                        : 'Stop all trading immediately (24h)'
                      }
                    </div>
                  </div>
                  <button
                    onClick={() => handleKillSwitch(safety.killSwitchActive ? 'deactivate' : 'activate')}
                    className={cn('px-5 py-2.5 text-sm font-black rounded-lg transition-all',
                      safety.killSwitchActive
                        ? 'border-2 border-[var(--green)] text-[var(--green)] hover:bg-[rgba(0,255,163,0.1)]'
                        : 'bg-[var(--red)] text-white hover:brightness-110'
                    )}
                  >
                    {safety.killSwitchActive ? 'DEACTIVATE' : 'ACTIVATE KILL SWITCH'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-[11px]" style={{ color: 'var(--text-muted)' }}>Loading safety status...</div>
          )}
        </Section>

        {/* ─── AUTO TRADE ─────────────────────────────────────────── */}
        <Section title="Auto-Trading" icon="🤖">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Automatic Execution</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                When enabled, AI automatically opens/closes trades. When disabled, it only generates signals.
              </div>
            </div>
            <button
              onClick={() => saveField({ auto_trade_enabled: !settings?.auto_trade_enabled })}
              className={cn('w-12 h-6 rounded-full transition-colors relative',
                settings?.auto_trade_enabled ? 'bg-[var(--green)]' : 'bg-[var(--bg-secondary)]'
              )}
              style={{ border: '1px solid var(--border)' }}
            >
              <span className={cn('w-5 h-5 rounded-full absolute top-0.5 transition-all',
                settings?.auto_trade_enabled ? 'left-6 bg-black' : 'left-0.5 bg-[var(--text-muted)]'
              )} />
            </button>
          </div>
          {settings?.auto_trade_enabled && isLive && (
            <div className="mt-3 p-3 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(255,51,102,0.08)', color: 'var(--red)', border: '1px solid var(--red)' }}>
              Auto-trading is ACTIVE with REAL money. AI signals are executed on {EXCHANGES.find(e => e.id === settings?.primary_exchange)?.name || 'the primary exchange'}.
            </div>
          )}
        </Section>

        {/* ─── APPEARANCE ─────────────────────────────────────────── */}
        <Section title="Appearance" icon="🎨">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Theme</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Light or dark mode</div>
            </div>
            <button onClick={toggle}
              className="px-4 py-2 text-sm font-bold rounded-lg transition-colors"
              style={{ border: '1px solid var(--border)', color: 'var(--text-primary)', background: 'var(--bg-secondary)' }}
            >
              {theme === 'light' ? 'DARK MODE' : 'LIGHT MODE'}
            </button>
          </div>
        </Section>

        {/* ─── PROFILE ────────────────────────────────────────────── */}
        <Section title="Profile" icon="👤">
          <div className="space-y-3">
            {[
              { label: 'Name', value: user?.name },
              { label: 'Email', value: user?.email },
              { label: 'User ID', value: user?.id, mono: true },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                <span className={cn('text-sm font-bold', row.mono && 'text-[10px] font-mono')} style={{ color: 'var(--text-primary)' }}>
                  {row.value ?? '—'}
                </span>
              </div>
            ))}
            <div className="pt-3 border-t border-[var(--border)]">
              <button onClick={handleLogout} className="text-sm font-bold hover:underline" style={{ color: 'var(--red)' }}>
                Log Out
              </button>
            </div>
          </div>
        </Section>

        {/* ─── FOOTER ─────────────────────────────────────────────── */}
        <div className="text-center py-6 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          APEX Trading Terminal v1.0 — All data is encrypted
        </div>
      </main>
    </div>
  )
}
