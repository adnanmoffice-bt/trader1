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

interface WalletData {
  configured: boolean
  connected: boolean
  balances: { asset: string; free: number; locked: number; total: number }[]
  summary: { usdt_free: number; usdt_total: number; btc_total: number; eth_total: number; total_assets: number }
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
      setSaveMsg('Sačuvano!')
      await loadSettings()
    } else {
      setSaveMsg(data.error || 'Greška')
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  const currentExMeta = EXCHANGES.find(e => e.id === selectedExchange)!

  async function testExchange() {
    if (!apiKey || !secretKey) { setTestResult({ success: false, message: 'Unesi oba ključa' }); return }
    if (currentExMeta.needsPassphrase && !passphrase) { setTestResult({ success: false, message: 'Unesi Passphrase' }); return }
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
          message: `${data.exchangeName} povezan! ${data.quoteAsset}: $${data.quoteBalance.toFixed(2)} | Trading: ${data.canTrade ? 'DA' : 'NE'}`,
          warning: data.warning,
        })
      } else {
        setTestResult({ success: false, message: data.error })
      }
    } catch {
      setTestResult({ success: false, message: 'Greška pri testiranju' })
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
      setSaveMsg('Prvo konfiguriši barem jedan exchange!')
      setTimeout(() => setSaveMsg(''), 3000)
      return
    }
    if (newMode === 'live' && !confirm('PAŽNJA: Prelaziš na LIVE trading sa pravim novcem. Nastaviti?')) return
    await saveField({ trading_mode: newMode })
  }

  async function handleKillSwitch(action: 'activate' | 'deactivate') {
    if (action === 'activate' && !confirm('KILL SWITCH će zaustaviti SVE trgovanje na 24h. Nastaviti?')) return
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
    if (!instId || !waApiToken) { setWaTestResult({ success: false, message: 'Unesi Instance ID i API Token' }); return }
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
        setWaTestResult({ success: true, message: `Povezano! Telefon: +${data.phone}` })
      } else {
        setWaTestResult({ success: false, message: data.error || 'Greška' })
      }
    } catch {
      setWaTestResult({ success: false, message: 'Greška pri testiranju' })
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
      setWaTestResult({ success: false, message: 'Unesi API Token prije čuvanja!' })
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
    setWaTestResult({ success: true, message: 'WhatsApp konfiguracija sačuvana! Token je u bazi.' })
  }

  async function sendTestWaMessage() {
    const instId = waInstanceId || settings?.whatsapp_instance_id || ''
    const token = waApiToken
    const groupId = waSelectedGroup || settings?.whatsapp_group_id || ''
    if (!instId || !groupId) { setWaTestResult({ success: false, message: 'Sačuvaj konfiguraciju prvo (Instance ID + Grupa)' }); return }
    if (!token) { setWaTestResult({ success: false, message: 'Unesi API Token za slanje test poruke' }); return }
    setWaTesting(true)
    try {
      const res = await fetch('/api/settings/test-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: instId, apiToken: token, groupId, action: 'test-message' }),
      })
      const data = await res.json()
      setWaTestResult({ success: data.success, message: data.success ? 'Test poruka poslana u grupu!' : (data.error || 'Greška') })
    } catch {
      setWaTestResult({ success: false, message: 'Greška' })
    }
    setWaTesting(false)
  }

  const isLive = settings?.trading_mode === 'live'

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--border)]" style={{ background: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-4">
          <a href="/" className="text-lg font-black" style={{ color: 'var(--amber)' }}>APEX</a>
          <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-wider">PODEŠAVANJA</span>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={cn('text-[11px] font-bold px-3 py-1 rounded-full animate-pulse',
              saveMsg === 'Sačuvano!' ? 'text-[var(--green)] bg-[rgba(0,255,163,0.1)]' : 'text-[var(--red)] bg-[rgba(255,51,102,0.1)]'
            )}>{saveMsg}</span>
          )}
          <a href="/" className="text-[11px] font-bold px-3 py-1 rounded" style={{ color: 'var(--cyan)', border: '1px solid var(--cyan)' }}>TERMINAL</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-5">

        {/* ─── TRADING MODE ──────────────────────────────────────────── */}
        <Section title="Režim Trgovanja" icon="⚡"
          badge={<Badge text={isLive ? 'LIVE' : 'DEMO'} ok={!isLive} />}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {isLive ? 'LIVE — Pravi novac' : 'DEMO — Simulacija'}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {isLive
                  ? `AI trguje na ${EXCHANGES.find(e => e.id === settings?.primary_exchange)?.name || 'exchange-u'} sa pravim sredstvima`
                  : `Virtualni kapital: $${riskForm.initial_capital.toLocaleString()}`
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
              {isLive ? 'PREBACI NA DEMO' : 'PREBACI NA LIVE'}
            </button>
          </div>
          {isLive && (
            <div className="mt-3 p-3 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(255,51,102,0.08)', color: 'var(--red)', border: '1px solid var(--red)' }}>
              UPOZORENJE: AI signali se izvršavaju sa pravim novcem na {EXCHANGES.find(e => e.id === settings?.primary_exchange)?.name || 'exchange-u'}. Kill switch ispod.
            </div>
          )}
        </Section>

        {/* ─── EXCHANGE CONNECTIONS ─────────────────────────────────── */}
        <Section title="Exchange Konekcije" icon="🏦"
          badge={<Badge text={anyExchangeConfigured ? `${(settings?.configured_exchanges?.length ?? 0) + (settings?.binance_configured ? 1 : 0)} POVEZAN` : 'NIJEDAN'} ok={!!anyExchangeConfigured} />}
        >
          {/* Connected exchanges */}
          {(settings?.binance_configured || (settings?.configured_exchanges?.length ?? 0) > 0) && (
            <div className="mb-4 space-y-2">
              <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--text-muted)' }}>POVEZANI EXCHANGE-OVI</div>
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
                    {settings?.primary_exchange === 'binance' ? 'PRIMARNI' : 'POSTAVI KAO PRIMARNI'}
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
                      {settings?.primary_exchange === ex.id ? 'PRIMARNI' : 'POSTAVI KAO PRIMARNI'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Exchange selector */}
          <div className="mb-3">
            <label className="text-[10px] font-bold block mb-2" style={{ color: 'var(--text-muted)' }}>DODAJ EXCHANGE</label>
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
                placeholder={`Unesi ${currentExMeta.name} API Key`}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{currentExMeta.name} SECRET KEY</label>
              <input type="password" value={secretKey} onChange={e => setSecretKey(e.target.value)}
                placeholder={`Unesi ${currentExMeta.name} Secret Key`}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            {currentExMeta.needsPassphrase && (
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--amber)' }}>PASSPHRASE (obavezno za {currentExMeta.name})</label>
                <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                  placeholder={`Unesi ${currentExMeta.name} Passphrase`}
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
                {testing ? 'TESTIRAM...' : `TESTIRAJ ${currentExMeta.name.toUpperCase()}`}
              </button>
              <button onClick={saveExchangeKeys} disabled={saving || !apiKey || !secretKey}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ background: 'var(--green)', color: '#000' }}
              >
                SAČUVAJ KLJUČEVE
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
            <br />Uključi samo <strong>&quot;Enable Spot Trading&quot;</strong>. NIKADA ne uključuj Withdrawal.
            {currentExMeta.needsPassphrase && <><br /><span style={{ color: 'var(--amber)' }}>⚠️ {currentExMeta.name} zahtijeva Passphrase koji se postavlja pri kreiranju API ključa.</span></>}
          </div>
        </Section>

        {/* ─── WALLET ─────────────────────────────────────────────── */}
        {anyExchangeConfigured && (
          <Section title="Novčanik" icon="💰"
            badge={
              <button onClick={loadWallet} disabled={walletLoading}
                className="text-[9px] font-bold px-2 py-0.5 rounded"
                style={{ color: 'var(--cyan)', border: '1px solid var(--cyan)' }}
              >
                {walletLoading ? 'UČITAVAM...' : 'OSVJEŽI'}
              </button>
            }
          >
            {wallet ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>USDT RASPOLOŽIVO</div>
                    <div className="text-xl font-black mt-1" style={{ color: 'var(--green)' }}>
                      ${wallet.summary.usdt_free.toFixed(2)}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      ${wallet.summary.usdt_free.toFixed(0)} USD
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

                {wallet.balances.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--text-muted)' }}>SVI ASSETI ({wallet.summary.total_assets})</div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {wallet.balances.map(b => (
                        <div key={b.asset} className="flex items-center justify-between py-1 px-2 rounded text-[11px]" style={{ background: 'var(--bg-secondary)' }}>
                          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{b.asset}</span>
                          <div className="flex gap-4">
                            <span style={{ color: 'var(--text-secondary)' }}>Slobodno: <span className="font-mono font-bold">{b.free.toFixed(b.asset === 'USDT' ? 2 : 6)}</span></span>
                            {b.locked > 0 && <span style={{ color: 'var(--amber)' }}>Zaključano: <span className="font-mono">{b.locked.toFixed(6)}</span></span>}
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
                      {wallet.permissions.can_withdraw ? 'Withdrawal UKLJUČEN — isključi!' : 'Withdrawal isključen'}
                    </span>
                  </div>
                </div>
              </div>
            ) : walletLoading ? (
              <div className="text-center py-8 text-[11px]" style={{ color: 'var(--text-muted)' }}>Učitavam wallet podatke...</div>
            ) : (
              <div className="text-center py-8 text-[11px]" style={{ color: 'var(--text-muted)' }}>Nije moguće učitati — provjeri API ključeve</div>
            )}
          </Section>
        )}

        {/* ─── RISK CONTROLS ──────────────────────────────────────── */}
        <Section title="Kontrola Rizika" icon="🛡️">
          <div className="space-y-4">
            {[
              { key: 'max_drawdown_pct', label: 'Max Drawdown', unit: '%', min: 5, max: 30, step: 1, desc: 'Kill-switch ako portfolio padne ispod ovog procenta' },
              { key: 'daily_loss_limit_pct', label: 'Dnevni Limit Gubitka', unit: '%', min: 1, max: 10, step: 0.5, desc: 'Zaustavi trading za danas ako gubici pređu' },
              { key: 'max_positions', label: 'Max Otvorenih Pozicija', unit: '', min: 1, max: 10, step: 1, desc: 'Koliko istovremenih trade-ova' },
              { key: 'risk_per_trade_pct', label: 'Rizik Po Trade-u', unit: '%', min: 0.5, max: 5, step: 0.5, desc: 'Maksimalan kapital po jednom trade-u' },
              { key: 'min_risk_reward', label: 'Min Risk:Reward', unit: ':1', min: 1, max: 5, step: 0.5, desc: 'Minimalan odnos nagrade prema riziku' },
              { key: 'max_sl_pct', label: 'Max Stop Loss', unit: '%', min: 1, max: 15, step: 1, desc: 'Maksimalan SL od entry cijene' },
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
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Početni Kapital</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Početna vrijednost portfolia u USD</div>
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
                SAČUVAJ LIMITE
              </button>
            </div>
          </div>
        </Section>

        {/* ─── TELEGRAM ───────────────────────────────────────────── */}
        <Section title="Telegram Notifikacije" icon="📱"
          badge={<Badge text={settings?.telegram_configured ? 'AKTIVNO' : 'NIJE KONFIGURISAN'} ok={!!settings?.telegram_configured} />}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Notifikacije</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Šalje alert na telefon za svaki trade</div>
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
                placeholder={settings?.telegram_configured ? 'Unesi novi za promjenu...' : 'Unesi Bot Token od @BotFather'}
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
                placeholder="Tvoj Chat ID (pošalji /start @userinfobot)"
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
                SAČUVAJ TELEGRAM
              </button>
            </div>
          </div>
        </Section>

        {/* ─── WHATSAPP ─────────────────────────────────────────────── */}
        <Section title="WhatsApp Grupa" icon="💬"
          badge={<Badge text={settings?.whatsapp_configured ? 'POVEZAN' : 'NIJE KONFIGURISAN'} ok={!!settings?.whatsapp_configured} />}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>WhatsApp Notifikacije</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Šalje signale, trade-ove i izvještaje u WhatsApp grupu</div>
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
                  <div className="text-[11px] font-bold" style={{ color: 'var(--green)' }}>Green API Povezan</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Instance: {settings.whatsapp_instance_id}
                    {settings.whatsapp_group_name && ` | Grupa: ${settings.whatsapp_group_name}`}
                    {settings.whatsapp_group_id && !settings.whatsapp_group_name && ` | Grupa: ${settings.whatsapp_group_id}`}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Token: {settings.whatsapp_api_token_set ? '✅ u bazi' : '❌ NIJE SAČUVAN'}
                    {' | '}Enabled: {settings.whatsapp_enabled ? '✅' : '❌ OFF'}
                    {' | '}Grupa: {settings.whatsapp_group_id ? '✅' : '❌ NEMA'}
                  </div>
                </div>
              </div>
            )}
            {!settings?.whatsapp_configured && settings?.whatsapp_instance_id && (
              <div className="mb-3 p-3 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(255,204,0,0.08)', color: 'var(--amber)', border: '1px solid var(--amber)' }}>
                Instance ID postoji ali API Token NEDOSTAJE u bazi. Unesi token i klikni Sačuvaj.
              </div>
            )}

            <div>
              <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>INSTANCE ID</label>
              <input
                type="text"
                value={waInstanceId}
                onChange={e => setWaInstanceId(e.target.value)}
                placeholder={settings?.whatsapp_instance_id || 'npr. 7107578215'}
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
                placeholder={settings?.whatsapp_configured ? 'Unesi novi za promjenu...' : 'Unesi API Token od Green API'}
                className="w-full px-3 py-2 text-sm rounded-lg font-mono"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={testWhatsApp} disabled={waTesting || !waApiToken}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ border: '1px solid var(--cyan)', color: 'var(--cyan)' }}
              >
                {waTesting ? 'TESTIRAM...' : 'TESTIRAJ KONEKCIJU'}
              </button>
              <button onClick={loadWaGroups} disabled={waGroupsLoading || !waApiToken}
                className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                style={{ border: '1px solid var(--amber)', color: 'var(--amber)' }}
              >
                {waGroupsLoading ? 'UČITAVAM...' : 'UČITAJ GRUPE'}
              </button>
            </div>

            {waGroups.length > 0 && (
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>ODABERI GRUPU</label>
                <select
                  value={waSelectedGroup || settings?.whatsapp_group_id || ''}
                  onChange={e => setWaSelectedGroup(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                >
                  <option value="">— Odaberi grupu —</option>
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
                SAČUVAJ WHATSAPP
              </button>
              {(waSelectedGroup || settings?.whatsapp_group_id) && waApiToken && (
                <button onClick={sendTestWaMessage} disabled={waTesting}
                  className="px-4 py-2 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-30"
                  style={{ border: '1px solid var(--purple)', color: 'var(--purple)' }}
                >
                  POŠALJI TEST PORUKU
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 p-3 rounded-lg text-[10px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
            <strong>Setup:</strong> green-api.com → Kreiraj instancu → Skeniraj QR → Kopiraj Instance ID + API Token
          </div>
        </Section>

        {/* ─── SAFETY STATUS + KILL SWITCH ─────────────────────────── */}
        <Section title="Sigurnosni Status" icon="🚨"
          badge={safety && <Badge text={safety.safe ? 'SVE OK' : 'UPOZORENJE'} ok={safety.safe} />}
        >
          {safety ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className={cn('w-4 h-4 rounded-full', safety.safe ? 'bg-[var(--green)]' : 'bg-[var(--red)] animate-pulse')} />
                <span className={cn('text-sm font-bold', safety.safe ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                  {safety.safe ? 'Svi sistemi OK' : (safety.reason || 'Problem detektovan')}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Drawdown', value: `${(safety.drawdownPct * 100).toFixed(1)}%`, ok: safety.drawdownPct < 0.15 },
                  { label: 'Današnji P&L', value: `${safety.todayPnl >= 0 ? '+' : ''}$${safety.todayPnl.toFixed(0)}`, ok: safety.todayPnl >= 0 },
                  { label: 'Otvorene Pozicije', value: `${safety.openPositions} / ${safety.maxPositions}`, ok: safety.openPositions < safety.maxPositions },
                  { label: 'Kapital', value: `$${safety.currentCapital.toLocaleString()}`, ok: true },
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
                        ? 'AKTIVAN — sav trading je zaustavljen'
                        : 'Zaustavi sav trading odmah (24h)'
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
                    {safety.killSwitchActive ? 'DEAKTIVIRAJ' : 'AKTIVIRAJ KILL SWITCH'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-[11px]" style={{ color: 'var(--text-muted)' }}>Učitavam sigurnosni status...</div>
          )}
        </Section>

        {/* ─── AUTO TRADE ─────────────────────────────────────────── */}
        <Section title="Auto-Trading" icon="🤖">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Automatsko Izvršavanje</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Kad je uključeno, AI automatski otvara/zatvara trade-ove. Kad je isključeno, samo generiše signale.
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
              Auto-trading je AKTIVAN sa PRAVIM novcem. AI signali se izvršavaju na {EXCHANGES.find(e => e.id === settings?.primary_exchange)?.name || 'primarnom exchange-u'}.
            </div>
          )}
        </Section>

        {/* ─── APPEARANCE ─────────────────────────────────────────── */}
        <Section title="Izgled" icon="🎨">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tema</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Svijetli ili tamni mod</div>
            </div>
            <button onClick={toggle}
              className="px-4 py-2 text-sm font-bold rounded-lg transition-colors"
              style={{ border: '1px solid var(--border)', color: 'var(--text-primary)', background: 'var(--bg-secondary)' }}
            >
              {theme === 'light' ? 'TAMNI MOD' : 'SVIJETLI MOD'}
            </button>
          </div>
        </Section>

        {/* ─── PROFILE ────────────────────────────────────────────── */}
        <Section title="Profil" icon="👤">
          <div className="space-y-3">
            {[
              { label: 'Ime', value: user?.name },
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
                Odjavi Se
              </button>
            </div>
          </div>
        </Section>

        {/* ─── FOOTER ─────────────────────────────────────────────── */}
        <div className="text-center py-6 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          APEX Trading Terminal v1.0 — Svi podaci su enkriptovani
        </div>
      </main>
    </div>
  )
}
