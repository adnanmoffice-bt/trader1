import { create } from 'zustand'
import type { AppStore } from '@/types'

export const useStore = create<AppStore>((set) => ({
  prices: {}, fearGreedIndex: 50,
  setPrices: (data) => set({ prices: Object.fromEntries(data.map(d => [d.symbol, d])) }),
  updatePrice: (data) => set(s => ({ prices: { ...s.prices, [data.symbol]: data } })),
  setFearGreed: (value) => set({ fearGreedIndex: value }),
  signals: [],
  addSignal: (signal) => set(s => ({ signals: [signal, ...s.signals].slice(0, 50) })),
  setSignals: (signals) => set({ signals }),
  portfolio: null, positions: [],
  setPortfolio: (portfolio) => set({ portfolio }),
  setPositions: (positions) => set({ positions }),
  news: [], setNews: (news) => set({ news }),
  agentLogs: [],
  addAgentLog: (log) => set(s => ({ agentLogs: [log, ...s.agentLogs].slice(0, 100) })),
  demoSession: null,
  setDemoSession: (demoSession) => set({ demoSession }),
  selectedInstrument: 'BTC/USD',
  setSelectedInstrument: (selectedInstrument) => set({ selectedInstrument }),
}))
