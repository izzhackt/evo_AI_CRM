import { AiError, type ChatMessage } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const GEMINI_INTERACTIONS_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions'

type GeminiContentBlock = string | { text?: unknown; type?: unknown }

interface GeminiStep {
  type?: string
  content?: GeminiContentBlock | GeminiContentBlock[]
}

interface GeminiResponse {
  output_text?: unknown
  outputText?: unknown
  steps?: GeminiStep[]
}

/**
 * Call Google's Gemini Interactions API with the account's own key.
 * The app sends the policy/business prompt through Gemini's native
 * `system_instruction` channel and keeps the WhatsApp transcript in
 * user input. Returns raw model text; `generateReply` handles handoff
 * parsing.
 */
export async function generateGemini(args: ProviderArgs): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        system_instruction: systemPrompt,
        input: buildGeminiInput(messages),
        generation_config: {
          max_output_tokens: MAX_OUTPUT_TOKENS,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const text = extractGeminiText(data)
  if (!text) {
    throw new AiError('Gemini returned an empty response.', {
      code: 'empty_response',
    })
  }
  return text
}

function buildGeminiInput(messages: ChatMessage[]): string {
  const transcript = mergeConsecutive(messages)
    .map((message) => {
      const speaker = message.role === 'assistant' ? 'Business' : 'Customer'
      return `${speaker}: ${message.content}`
    })
    .join('\n\n')

  return [
    'Recent WhatsApp conversation, oldest first:',
    transcript || 'Customer: ping',
    'Write only the next business reply.',
  ].join('\n\n')
}

function extractGeminiText(data: GeminiResponse | null): string {
  if (!data) return ''
  if (typeof data.output_text === 'string') return data.output_text.trim()
  if (typeof data.outputText === 'string') return data.outputText.trim()

  const steps = Array.isArray(data.steps) ? data.steps : []
  for (const step of steps.slice().reverse()) {
    if (step.type !== 'model_output') continue
    const text = extractContentText(step.content)
    if (text) return text
  }
  return ''
}

function extractContentText(content: GeminiStep['content']): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      if (typeof block === 'string') return block
      if (typeof block?.text === 'string') return block.text
      return ''
    })
    .join('')
    .trim()
}
