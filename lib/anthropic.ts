import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export const MODEL = 'claude-sonnet-4-20250514'

interface CallAgentOptions {
  system: string
  user: string
  maxTokens?: number
  expectJson?: boolean
  timeoutMs?: number
}

export async function callAgent<T = string>(opts: CallAgentOptions): Promise<T> {
  const { system, user, maxTokens = 1024, expectJson = false, timeoutMs = 25_000 } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { signal: controller.signal }
    )

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

export { client as anthropic }
