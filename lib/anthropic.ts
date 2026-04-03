import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export const MODEL = 'claude-sonnet-4-20250514'

interface CallAgentOptions {
  system: string
  user: string
  maxTokens?: number
  expectJson?: boolean
}

/**
 * Call Claude with a system + user prompt.
 * If expectJson=true, strips code fences and parses JSON.
 */
export async function callAgent<T = string>(opts: CallAgentOptions): Promise<T> {
  const { system, user, maxTokens = 1024, expectJson = false } = opts

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')

  if (!expectJson) return text as T

  // Strip markdown code fences if present
  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  return JSON.parse(clean) as T
}

export { client as anthropic }
