import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export const MODEL = 'claude-opus-4-20250514'
export const MODEL_SONNET = 'claude-sonnet-4-20250514'
export const MODEL_FAST = 'claude-3-5-haiku-20241022'

// Cost per 1M tokens (USD) — used for budget tracking
export const MODEL_COSTS = {
  [MODEL]:        { input: 15.00, output: 75.00 },
  [MODEL_SONNET]: { input: 3.00,  output: 15.00 },
  [MODEL_FAST]:   { input: 0.80,  output: 4.00 },
} as Record<string, { input: number; output: number }>

interface CallAgentOptions {
  system: string
  user: string
  maxTokens?: number
  expectJson?: boolean
  timeoutMs?: number
  model?: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  model: string
  estimatedCost: number
}

export async function callAgent<T = string>(opts: CallAgentOptions): Promise<T> {
  const { system, user, maxTokens = 1024, expectJson = false, timeoutMs = 25_000, model = MODEL } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { signal: controller.signal }
    )

    const costs = MODEL_COSTS[model] ?? MODEL_COSTS[MODEL]
    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
      estimatedCost:
        (response.usage.input_tokens / 1_000_000) * costs.input +
        (response.usage.output_tokens / 1_000_000) * costs.output,
    }
    trackDailySpend(usage)

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    if (!expectJson) return text as T

    const clean = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    return JSON.parse(clean) as T
  } finally {
    clearTimeout(timer)
  }
}

// ─── Daily budget tracking (in-memory, resets on cold start / new day) ────────

const DAILY_BUDGET_USD = parseFloat(process.env.AI_DAILY_BUDGET ?? '5.00')

let dayKey = ''
let dailySpend = 0
let dailyCalls = 0

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

const alertsSent = new Set<string>()

function trackDailySpend(usage: TokenUsage) {
  const today = todayKey()
  if (dayKey !== today) {
    dayKey = today
    dailySpend = 0
    dailyCalls = 0
    alertsSent.clear()
  }
  dailySpend += usage.estimatedCost
  dailyCalls++
  checkBudgetAlerts()
}

async function checkBudgetAlerts() {
  const pct = dailySpend / DAILY_BUDGET_USD
  const thresholds = [
    { level: 0.5, label: '50%' },
    { level: 0.8, label: '80%' },
    { level: 1.0, label: '100%' },
  ]
  for (const t of thresholds) {
    if (pct >= t.level && !alertsSent.has(t.label)) {
      alertsSent.add(t.label)
      const msg = `⚠️ AI BUDGET ${t.label}: $${dailySpend.toFixed(2)} / $${DAILY_BUDGET_USD.toFixed(2)} (${dailyCalls} calls)`
      console.warn(`[budget-alert] ${msg}`)
      try {
        const { sendBudgetAlert } = await import('@/lib/telegram')
        await sendBudgetAlert(msg).catch(() => {})
      } catch { /* telegram not configured */ }
    }
  }
}

export function getDailyBudgetStatus() {
  const today = todayKey()
  if (dayKey !== today) return { spent: 0, remaining: DAILY_BUDGET_USD, budget: DAILY_BUDGET_USD, calls: 0, exhausted: false }
  const remaining = Math.max(0, DAILY_BUDGET_USD - dailySpend)
  return { spent: +dailySpend.toFixed(4), remaining: +remaining.toFixed(4), budget: DAILY_BUDGET_USD, calls: dailyCalls, exhausted: remaining <= 0 }
}

export { client as anthropic }
