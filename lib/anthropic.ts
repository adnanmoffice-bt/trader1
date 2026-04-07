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

// ─── Daily budget tracking (persisted to Supabase, survives cold starts) ──────

const DAILY_BUDGET_USD = parseFloat(process.env.AI_DAILY_BUDGET ?? '5.00')

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function trackDailySpend(usage: TokenUsage) {
  // Fire-and-forget: log cost to DB so getDailyBudgetStatus can sum it
  import('@/lib/supabase').then(({ createServiceSupabase }) => {
    const db = createServiceSupabase()
    db.from('agent_logs').insert({
      agent: 'budget-tracker',
      level: 'info',
      message: `AI call: ${usage.model} ${usage.inputTokens}in/${usage.outputTokens}out $${usage.estimatedCost.toFixed(4)}`,
      metadata: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        model: usage.model,
        cost_usd: usage.estimatedCost,
        date: todayKey(),
      },
    }).then(() => {
      checkBudgetAlerts(usage.estimatedCost)
    })
  }).catch(() => {})
}

// In-memory accumulator for alert dedup within a single invocation
const alertsSent = new Set<string>()
let invocationSpend = 0

async function checkBudgetAlerts(costJustAdded: number) {
  invocationSpend += costJustAdded
  try {
    const status = await getDailyBudgetStatus()
    const pct = status.spent / DAILY_BUDGET_USD
    const thresholds = [
      { level: 0.5, label: '50%' },
      { level: 0.8, label: '80%' },
      { level: 1.0, label: '100%' },
    ]
    for (const t of thresholds) {
      if (pct >= t.level && !alertsSent.has(t.label)) {
        alertsSent.add(t.label)
        const msg = `AI BUDGET ${t.label}: $${status.spent.toFixed(2)} / $${DAILY_BUDGET_USD.toFixed(2)} (${status.calls} calls)`
        console.warn(`[budget-alert] ${msg}`)
        try {
          const { sendBudgetAlert } = await import('@/lib/telegram')
          await sendBudgetAlert(msg).catch(() => {})
        } catch { /* telegram not configured */ }
      }
    }
  } catch { /* DB query failed, alerts skipped */ }
}

export async function getDailyBudgetStatus(): Promise<{
  spent: number; remaining: number; budget: number; calls: number; exhausted: boolean
}> {
  try {
    const { createServiceSupabase } = await import('@/lib/supabase')
    const db = createServiceSupabase()
    const today = todayKey()

    const { data } = await db.from('agent_logs')
      .select('metadata')
      .eq('agent', 'budget-tracker')
      .gte('created_at', `${today}T00:00:00Z`)

    let spent = 0
    let calls = 0
    for (const row of data ?? []) {
      const meta = row.metadata as Record<string, unknown> | null
      if (meta?.cost_usd) {
        spent += Number(meta.cost_usd)
        calls++
      }
    }

    const remaining = Math.max(0, DAILY_BUDGET_USD - spent)
    return { spent: +spent.toFixed(4), remaining: +remaining.toFixed(4), budget: DAILY_BUDGET_USD, calls, exhausted: remaining <= 0 }
  } catch {
    return { spent: 0, remaining: DAILY_BUDGET_USD, budget: DAILY_BUDGET_USD, calls: 0, exhausted: false }
  }
}

export { client as anthropic }
