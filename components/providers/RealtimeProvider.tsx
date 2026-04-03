'use client'
import { useEffect } from 'react'
import { getBrowserSupabase } from '@/lib/supabase'
import { useStore } from '@/lib/store'
import type { Signal, MarketData, AgentLog, Position } from '@/types'

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { addSignal, updatePrice, addAgentLog, setPositions } = useStore()
  useEffect(() => {
    const sb = getBrowserSupabase()
    const ch = sb.channel('apex-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals' }, p => addSignal(p.new as Signal))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'market_data' }, p => updatePrice(p.new as MarketData))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_logs' }, p => addAgentLog(p.new as AgentLog))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions' }, async () => {
        const { data } = await sb.from('positions').select('*')
        if (data) setPositions(data as Position[])
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])
  return <>{children}</>
}
