'use client'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { RealtimeProvider } from '@/components/providers/RealtimeProvider'
import type { Signal, MarketData } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtPrice(n: number | null): string {
  if (!n) return '—'
  return n >= 1000
    ? '$' + n.toLocaleString('en', { minimumFractionDigits: 2 })
    : '$' + n.toFixed(2)
}
function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

// ── Price Strip ───────────────────────────────────────────────────────────────
function PriceStrip({ prices }: { prices: Record<string, MarketData> }) {
  const symbols = ['BTC/USD', 'ETH/USD', 'BRENT', 'XAU/USD', 'SPY']
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
      {symbols.map(sym => {
        const d = prices[sym]
        const up = (d?.change_pct_24h ?? 0) >= 0
        return (
          <div key={sym} className="flex-shrink-0 bg-[#0f0f1e] border border-white/[0.07] rounded-lg px-4 py-2 min-w-[130px]">
            <div className="text-[10px] font-bold text-[#44446a] tracking-wider mb-1">{sym}</div>
            <div className="text-base font-bold mono text-[#e2e2f5]">
              {d ? fmtPrice(d.price) : '—'}
            </div>
            <div className={cn('text-[11px] font-bold', up ? 'text-[#00ffa3]' : 'text-[#ff3366]')}>
              {up ? '▲' : '▼'} {Math.abs(d?.change_pct_24h ?? 0).toFixed(2)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Signal Card ───────────────────────────────────────────────────────────────
function SignalCard({ s }: { s: Signal }) {
  const isLong  = s.direction === 'long'
  const isShort = s.direction === 'short'
  const barColor = s.confidence >= 75 ? '#00ffa3' : s.confidence >= 55 ? '#ffcc00' : '#ff3366'

  return (
    <div className={cn(
      'bg-[#0f0f1e] border border-white/[0.07] rounded-xl overflow-hidden transition-all hover:border-white/[0.14] hover:-translate-y-0.5 cursor-pointer',
      isLong  && 'border-t-2 border-t-[#00ffa3]',
      isShort && 'border-t-2 border-t-[#ff3366]',
      !isLong && !isShort && 'border-t-2 border-t-[#ffcc00]'
    )}>
      {/* Head */}
      <div className="flex items-start justify-between p-3 bg-[#111122]">
        <div>
          <div className="text-sm font-bold text-[#e2e2f5]">{s.instrument}</div>
          <div className="text-[10px] text-[#44446a] mt-0.5">{new Date(s.created_at).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })} UAE</div>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <span className={cn(
            'text-[9px] font-black px-2 py-0.5 rounded tracking-wider',
            isLong  && 'bg-[rgba(0,255,163,0.18)] text-[#00ffa3]',
            isShort && 'bg-[rgba(255,51,102,0.18)] text-[#ff3366]',
            !isLong && !isShort && 'bg-[rgba(255,204,0,0.1)] text-[#ffcc00]'
          )}>{s.direction.toUpperCase()}</span>
          {s.risk_reward && (
            <span className="text-[9px] font-bold bg-[rgba(77,136,255,0.1)] text-[#4d88ff] px-2 py-0.5 rounded">
              R:R {s.risk_reward}×
            </span>
          )}
        </div>
      </div>

      {/* Levels */}
      {s.direction !== 'hold' && (
        <div className="grid grid-cols-3 gap-1.5 p-3">
          {[
            { l: 'ENTRY',  v: s.entry_price,    cls: 'text-[#e2e2f5]' },
            { l: 'STOP',   v: s.stop_loss,       cls: 'text-[#ff3366]' },
            { l: 'TARGET', v: s.take_profit_1,   cls: 'text-[#00ffa3]' },
          ].map(({ l, v, cls }) => (
            <div key={l} className="bg-[#07070f] rounded-md p-2">
              <div className="text-[8px] text-[#44446a] tracking-wider mb-1">{l}</div>
              <div className={cn('text-[11px] font-bold mono', cls)}>{fmtPrice(v)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Confidence */}
      <div className="px-3 pb-1">
        <div className="flex justify-between text-[9px] text-[#44446a] mb-1">
          <span>CONFIDENCE</span>
          <span style={{ color: barColor }} className="font-bold">{s.confidence}%</span>
        </div>
        <div className="h-1 bg-[#141428] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${s.confidence}%`, background: barColor }} />
        </div>
      </div>

      {/* AI */}
      <div className="mx-3 mb-3 mt-2 p-2 bg-[#07070f] rounded-lg">
        <div className="text-[8px] font-bold text-[#9966ff] tracking-wider mb-1">AI ANALIZA</div>
        <div className="text-[10px] text-[#7878aa] leading-relaxed">{s.ai_analysis}</div>
      </div>
    </div>
  )
}

// ── Agent Log Item ────────────────────────────────────────────────────────────
function LogItem({ log }: { log: any }) {
  const tagColor: Record<string, string> = {
    'orchestrator':    'bg-[rgba(153,102,255,0.09)] text-[#9966ff]',
    'market-analyst':  'bg-[rgba(77,136,255,0.08)] text-[#4d88ff]',
    'signal-generator':'bg-[rgba(0,255,163,0.18)] text-[#00ffa3]',
    'risk-manager':    'bg-[rgba(255,204,0,0.08)] text-[#ffcc00]',
    'trade-reviewer':  'bg-[rgba(0,204,255,0.08)] text-[#00ccff]',
  }
  const dotColor: Record<string, string> = {
    ok: 'bg-[#00ffa3]', warn: 'bg-[#ffcc00]', error: 'bg-[#ff3366]', info: 'bg-[#44446a]',
  }
  return (
    <div className="grid grid-cols-[44px_80px_1fr_10px] gap-2 items-start px-3 py-2 border-b border-white/[0.05] hover:bg-[#0f0f1e] transition-colors">
      <span className="text-[9px] text-[#44446a] mono pt-0.5">
        {new Date(log.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded w-fit ${tagColor[log.agent] ?? 'bg-[#141428] text-[#44446a]'}`}>
        {log.agent.split('-').map((w: string) => w[0].toUpperCase()).join('')}
      </span>
      <span className="text-[10px] text-[#7878aa]">{log.message}</span>
      <div className={`w-1.5 h-1.5 rounded-full mt-1 ${dotColor[log.level] ?? 'bg-[#44446a]'}`} />
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
function Dashboard() {
  const { prices, signals, agentLogs, portfolio, positions, fearGreedIndex } = useStore()
  const [activeTab, setActiveTab] = useState<'opportunities' | 'portfolio' | 'agents' | 'news'>('opportunities')
  const [clock, setClock] = useState('')

  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setClock(now)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Fetch initial data
  useEffect(() => {
    const store = useStore.getState()
    fetch('/api/prices').then(r => r.json()).then(d => { if (d.data) store.setPrices(d.data) })
    fetch('/api/signals').then(r => r.json()).then(d => { if (d.data) store.setSignals(d.data) })
  }, [])

  const totalPnl = positions.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0)
  const openCount = positions.length

  const tabs = [
    { id: 'opportunities', label: '📈 Prilike' },
    { id: 'portfolio',     label: '💼 Portfolio' },
    { id: 'agents',        label: '🤖 Agenti' },
    { id: 'news',          label: '📰 Vijesti' },
  ]

  return (
    <div className="flex flex-col h-screen bg-[#03030a]">
      {/* Header */}
      <header className="flex items-center justify-between px-5 h-12 bg-[#07070f] border-b border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-black tracking-tight text-[#e2e2f5]">APEX</span>
          <span className="flex items-center gap-1.5 text-[9px] font-bold text-[#00ffa3] tracking-[0.15em] px-2 py-1 border border-[rgba(0,255,163,0.2)] rounded bg-[rgba(0,255,163,0.07)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ffa3] animate-blink" />
            LIVE
          </span>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <div className="text-right">
            <div className="text-[9px] text-[#44446a] tracking-wider">KAPITAL</div>
            <div className="font-bold mono text-[#e2e2f5]">AED {(portfolio?.capital ?? 200000).toLocaleString()}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-[#44446a] tracking-wider">OPEN P&L</div>
            <div className={`font-bold mono ${totalPnl >= 0 ? 'text-[#00ffa3]' : 'text-[#ff3366]'}`}>
              {totalPnl >= 0 ? '+' : ''}AED {Math.abs(totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-[#44446a] tracking-wider">F&G</div>
            <div className={`font-bold mono ${fearGreedIndex > 60 ? 'text-[#00ffa3]' : fearGreedIndex < 40 ? 'text-[#ff3366]' : 'text-[#ffcc00]'}`}>
              {fearGreedIndex}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-[#44446a] tracking-wider">ABU DHABI</div>
            <div className="font-bold mono text-[#00ccff]">{clock}</div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-0.5 px-5 pt-2 bg-[#07070f] border-b border-white/[0.06] flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={cn(
              'px-4 py-2 text-[11px] font-semibold rounded-t border-b-2 transition-all',
              activeTab === t.id
                ? 'text-[#e2e2f5] border-[#00ccff] bg-[rgba(0,204,255,0.06)]'
                : 'text-[#44446a] border-transparent hover:text-[#7878aa] hover:bg-[#0f0f1e]'
            )}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-5">

        {/* ── PRILIKE ── */}
        {activeTab === 'opportunities' && (
          <div>
            <PriceStrip prices={prices} />

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#9966ff] shadow-[0_0_6px_#9966ff]" />
                <span className="text-[10px] font-bold tracking-widest text-[#44446a] uppercase">AI Signali</span>
              </div>
              <span className="text-[10px] text-[#44446a]">{signals.length} aktivnih</span>
            </div>

            {signals.length === 0 ? (
              <div className="text-center py-16 text-[#44446a]">
                <div className="text-2xl mb-3">⏳</div>
                <div className="text-sm">Čekam signal run... (svakih 30min)</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {signals.map(s => <SignalCard key={s.id} s={s} />)}
              </div>
            )}
          </div>
        )}

        {/* ── PORTFOLIO ── */}
        {activeTab === 'portfolio' && (
          <div>
            <div className="grid grid-cols-5 gap-2 mb-5">
              {[
                { l: 'KAPITAL',    v: `AED ${(portfolio?.capital ?? 200000).toLocaleString()}`, cls: 'text-[#e2e2f5]' },
                { l: 'OPEN P&L',   v: `${totalPnl >= 0 ? '+' : ''}AED ${Math.abs(totalPnl).toLocaleString(undefined,{maximumFractionDigits:0})}`, cls: totalPnl >= 0 ? 'text-[#00ffa3]' : 'text-[#ff3366]' },
                { l: 'WIN RATE',   v: `${portfolio?.win_rate?.toFixed(1) ?? '—'}%`, cls: 'text-[#00ffa3]' },
                { l: 'POZICIJE',   v: `${openCount}`, cls: 'text-[#00ccff]' },
                { l: 'FEAR & GREED', v: `${fearGreedIndex}`, cls: fearGreedIndex > 60 ? 'text-[#00ffa3]' : fearGreedIndex < 40 ? 'text-[#ff3366]' : 'text-[#ffcc00]' },
              ].map(stat => (
                <div key={stat.l} className="bg-[#0f0f1e] border border-white/[0.07] rounded-xl p-3">
                  <div className="text-[9px] text-[#44446a] tracking-wider mb-2">{stat.l}</div>
                  <div className={`text-lg font-black mono ${stat.cls}`}>{stat.v}</div>
                </div>
              ))}
            </div>

            <div className="bg-[#07070f] border border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-white/[0.06] bg-[#0f0f1e]">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#4d88ff]" />
                  <span className="text-[9px] font-bold tracking-widest text-[#44446a] uppercase">Otvorene Pozicije</span>
                </div>
              </div>
              {positions.length === 0 ? (
                <div className="text-center py-12 text-[#44446a] text-sm">Nema otvorenih pozicija</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>{['Instrument','Smjer','Ulaz','Trenutna','Stop','Target','P&L','%','Status'].map(h => (
                      <th key={h} className="text-left text-[9px] text-[#44446a] tracking-wider font-semibold px-4 py-2 border-b border-white/[0.06]">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {positions.map(p => {
                      const pnl = p.unrealized_pnl ?? 0
                      const pos = pnl >= 0
                      return (
                        <tr key={p.id} className="hover:bg-[#0f0f1e] transition-colors">
                          <td className="px-4 py-2.5 font-bold text-[#e2e2f5] text-xs">{p.instrument}</td>
                          <td className={`px-4 py-2.5 font-bold text-xs ${p.direction === 'long' ? 'text-[#00ffa3]' : 'text-[#ff3366]'}`}>{p.direction.toUpperCase()}</td>
                          <td className="px-4 py-2.5 mono text-xs text-[#7878aa]">{fmtPrice(p.avg_entry_price)}</td>
                          <td className={`px-4 py-2.5 mono text-xs font-bold ${pos ? 'text-[#00ffa3]' : 'text-[#ff3366]'}`}>{fmtPrice(p.current_price)}</td>
                          <td className="px-4 py-2.5 mono text-xs text-[#ff3366]">{fmtPrice(p.stop_loss)}</td>
                          <td className="px-4 py-2.5 mono text-xs text-[#00ffa3]">{fmtPrice(p.take_profit)}</td>
                          <td className={`px-4 py-2.5 mono text-xs font-bold ${pos ? 'text-[#00ffa3]' : 'text-[#ff3366]'}`}>{pos ? '+' : ''}AED {Math.abs(pnl).toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                          <td className={`px-4 py-2.5 mono text-xs font-bold ${pos ? 'text-[#00ffa3]' : 'text-[#ff3366]'}`}>{pos ? '+' : ''}{(p.unrealized_pnl_pct ?? 0).toFixed(2)}%</td>
                          <td className="px-4 py-2.5"><span className="text-[9px] font-bold bg-[rgba(77,136,255,0.1)] text-[#4d88ff] px-2 py-0.5 rounded">OPEN</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── AGENTI ── */}
        {activeTab === 'agents' && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { name:'Orchestrator',  col:'#9966ff', status:'AKTIVAN', desc:'Koordinira sve agente. Pokreće se svakih 30min.' },
                { name:'Market Analyst',col:'#4d88ff', status:'AKTIVAN', desc:'Čita RSS vijesti i analizira sentiment.' },
                { name:'Signal Generator',col:'#00ffa3',status:'AKTIVAN', desc:'RSI + MACD + BB → LONG/SHORT/HOLD signal.' },
                { name:'Risk Manager',  col:'#ffcc00', status:'AKTIVAN', desc:'Validira R:R, SL, max pozicije.' },
                { name:'Trade Reviewer',col:'#00ccff', status:'STANDBY', desc:'Dnevni review zatvorenih trejdova u 22:00.' },
              ].map(a => (
                <div key={a.name} className="bg-[#0f0f1e] border border-white/[0.07] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sm text-[#e2e2f5]">{a.name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold ${a.status === 'AKTIVAN' ? 'text-[#00ffa3]' : 'text-[#44446a]'}`}>{a.status}</span>
                      <div className="w-2 h-2 rounded-full" style={{ background: a.col, boxShadow: `0 0 6px ${a.col}` }} />
                    </div>
                  </div>
                  <p className="text-[11px] text-[#7878aa] leading-relaxed">{a.desc}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#ff3366] shadow-[0_0_6px_#ff3366]" />
              <span className="text-[9px] font-bold tracking-widest text-[#44446a] uppercase">Log Aktivnosti</span>
            </div>
            <div className="bg-[#07070f] border border-white/[0.06] rounded-xl overflow-hidden">
              {agentLogs.length === 0 ? (
                <div className="text-center py-8 text-[#44446a] text-sm">Čekam agent run...</div>
              ) : (
                agentLogs.map(log => <LogItem key={log.id} log={log} />)
              )}
            </div>
          </div>
        )}

        {/* ── VIJESTI ── */}
        {activeTab === 'news' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 text-[10px] text-[#44446a] mb-1">
              Vijesti se ažuriraju automatski svakih 15 minuta via NewsAPI + RSS
            </div>
            <div className="bg-[#0f0f1e] border border-white/[0.07] rounded-xl p-5 text-center text-[#44446a] col-span-2 py-16">
              <div className="text-2xl mb-3">📰</div>
              <div className="text-sm mb-1">NewsAPI integracija u toku</div>
              <div className="text-xs">Dodaj NEWS_API_KEY u .env.local i vijesti će se učitati automatski</div>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}

export default function Page() {
  return (
    <RealtimeProvider>
      <Dashboard />
    </RealtimeProvider>
  )
}
