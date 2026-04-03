// ─── Core Trading Types ────────────────────────────────────────────────────────

export type Instrument =
  | 'BTC/USD'
  | 'ETH/USD'
  | 'BRENT'
  | 'WTI'
  | 'XAU/USD'
  | 'XAG/USD'
  | 'SPY'
  | 'EUR/USD'
  | 'USD/JPY'

export type Direction = 'long' | 'short' | 'hold'
export type SignalStatus = 'active' | 'triggered' | 'expired' | 'cancelled'
export type TradeStatus = 'open' | 'closed' | 'stopped'
export type AgentName = 'orchestrator' | 'market-analyst' | 'signal-generator' | 'risk-manager' | 'trade-reviewer'
export type LogLevel = 'ok' | 'warn' | 'error' | 'info'
export type Sentiment = 'bullish' | 'bearish' | 'neutral'
export type MarketStatus = 'pre-market' | 'open' | 'after-hours' | 'closed'

// ─── Signal ────────────────────────────────────────────────────────────────────

export interface Signal {
  id: string
  instrument: Instrument
  direction: Direction
  entry_price: number | null
  stop_loss: number | null
  take_profit_1: number | null
  take_profit_2: number | null
  confidence: number           // 0–100
  risk_reward: number | null
  reasoning: string
  ai_analysis: string
  news_sentiment: Sentiment
  technical_score: number      // 0–100
  status: SignalStatus
  created_at: string
  expires_at: string
}

// ─── Trade ─────────────────────────────────────────────────────────────────────

export interface Trade {
  id: string
  signal_id: string | null
  user_id: string
  instrument: Instrument
  direction: Direction
  quantity: number
  entry_price: number
  exit_price: number | null
  stop_loss: number | null
  take_profit: number | null
  pnl: number | null
  pnl_pct: number | null
  pnl_aed: number | null
  status: TradeStatus
  is_demo: boolean
  opened_at: string
  closed_at: string | null
  notes: string | null
}

// ─── Position ──────────────────────────────────────────────────────────────────

export interface Position {
  id: string
  user_id: string
  instrument: Instrument
  direction: Direction
  quantity: number
  avg_entry_price: number
  current_price: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  unrealized_pnl_aed: number
  stop_loss: number | null
  take_profit: number | null
  is_demo: boolean
  opened_at: string
}

// ─── Portfolio ─────────────────────────────────────────────────────────────────

export interface Portfolio {
  id: string
  user_id: string
  capital: number
  available_capital: number
  total_value: number
  realized_pnl: number
  unrealized_pnl: number
  total_pnl: number
  total_pnl_pct: number
  win_count: number
  loss_count: number
  win_rate: number
  avg_risk_reward: number
  sharpe_ratio: number | null
  max_drawdown: number | null
  is_demo: boolean
  updated_at: string
}

// ─── Market Data ───────────────────────────────────────────────────────────────

export interface MarketData {
  id: string
  symbol: string
  price: number
  change_24h: number
  change_pct_24h: number
  volume_24h: number
  high_24h: number
  low_24h: number
  open_24h: number
  market_cap: number | null
  source: string
  fetched_at: string
}

export interface OHLCV {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ─── News & Sentiment ──────────────────────────────────────────────────────────

export interface NewsItem {
  id: string
  headline: string
  source: string
  url: string
  sentiment: Sentiment
  sentiment_score: number      // -1 to +1
  instruments: Instrument[]
  ai_summary: string
  published_at: string
  fetched_at: string
}

// ─── Agent Types ───────────────────────────────────────────────────────────────

export interface AgentLog {
  id: string
  agent: AgentName
  level: LogLevel
  message: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface AgentContext {
  instrument: Instrument
  current_price: number
  ohlcv_1h: OHLCV[]
  ohlcv_4h: OHLCV[]
  rsi: number
  macd: { value: number; signal: number; histogram: number }
  bb: { upper: number; middle: number; lower: number; width: number; percentB: number }
  ema_20: number
  ema_50: number
  ema_200: number
  atr: number
  volume_ratio: number
  news_sentiment: Sentiment
  fear_greed_index: number
  portfolio_capital: number
  open_positions_count: number
  max_positions: number
}

export interface AgentSignalOutput {
  instrument: Instrument
  direction: Direction
  entry_price: number | null
  stop_loss: number | null
  take_profit_1: number | null
  take_profit_2: number | null
  confidence: number
  risk_reward: number | null
  reasoning: string
  ai_analysis: string
}

// ─── Polymarket Types ──────────────────────────────────────────────────────────

export interface PolymarketEvent {
  id: string
  title: string
  description: string
  end_date: string
  markets: PolymarketMarket[]
}

export interface PolymarketMarket {
  id: string
  question: string
  token_id: string
  yes_price: number   // 0–1 (probability)
  no_price: number
  volume: number
  liquidity: number
  end_date: string
  resolved: boolean
  resolution: 'yes' | 'no' | null
}

// ─── Demo / Backtest ───────────────────────────────────────────────────────────

export interface DemoTrade {
  id: string
  session_id: string
  instrument: Instrument
  direction: Direction
  entry_price: number
  exit_price: number | null
  stop_loss: number
  take_profit: number
  quantity: number
  confidence: number
  signal_reason: string
  entry_time: string
  exit_time: string | null
  exit_reason: 'take_profit' | 'stop_loss' | 'manual' | 'open' | null
  pnl: number | null
  pnl_pct: number | null
  pnl_aed: number | null
}

export interface DemoSession {
  id: string
  start_date: string
  end_date: string
  initial_capital: number
  final_capital: number | null
  total_pnl: number | null
  total_pnl_pct: number | null
  win_count: number
  loss_count: number
  win_rate: number | null
  max_drawdown: number | null
  sharpe_ratio: number | null
  total_trades: number
  status: 'running' | 'completed' | 'failed'
  trades: DemoTrade[]
}

// ─── API Response Wrappers ─────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null
  error: string | null
  success: boolean
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
}

// ─── Store Types (Zustand) ─────────────────────────────────────────────────────

export interface AppStore {
  // Market data
  prices: Record<string, MarketData>
  fearGreedIndex: number
  setPrices: (data: MarketData[]) => void
  updatePrice: (data: MarketData) => void
  setFearGreed: (value: number) => void

  // Signals
  signals: Signal[]
  addSignal: (signal: Signal) => void
  setSignals: (signals: Signal[]) => void

  // Portfolio
  portfolio: Portfolio | null
  positions: Position[]
  setPortfolio: (p: Portfolio) => void
  setPositions: (p: Position[]) => void

  // News
  news: NewsItem[]
  setNews: (n: NewsItem[]) => void

  // Agent logs
  agentLogs: AgentLog[]
  addAgentLog: (log: AgentLog) => void

  // Demo
  demoSession: DemoSession | null
  setDemoSession: (s: DemoSession) => void

  // UI
  selectedInstrument: Instrument
  setSelectedInstrument: (i: Instrument) => void
}
