import { AiError, type ChatMessage } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const GEMINI_GENERATE_CONTENT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models'

type GeminiPart = { text?: unknown; thought?: unknown }

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[]
  }
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
}

/**
 * Call Google's Gemini GenerateContent API with the account's own key.
 * The app sends the policy/business prompt through Gemini's native
 * `systemInstruction` channel and keeps the WhatsApp transcript in
 * user content. Returns raw model text; `generateReply` handles handoff
 * parsing.
 */
export async function generateGemini(args: ProviderArgs): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(geminiGenerateContentUrl(model), {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        store: false,
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildGeminiInput(messages) }],
          },
        ],
        generationConfig: geminiGenerationConfig(model, MAX_OUTPUT_TOKENS),
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

function geminiGenerateContentUrl(model: string): string {
  const modelId = model.replace(/^models\//, '')
  return `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(modelId)}:generateContent`
}

function geminiGenerationConfig(
  model: string,
  maxOutputTokens: number,
): { maxOutputTokens: number; thinkingConfig?: { thinkingLevel: 'MINIMAL' } } {
  const config: {
    maxOutputTokens: number
    thinkingConfig?: { thinkingLevel: 'MINIMAL' }
  } = { maxOutputTokens }

  if (supportsThinkingLevel(model)) {
    config.thinkingConfig = { thinkingLevel: 'MINIMAL' }
  }

  return config
}

function supportsThinkingLevel(model: string): boolean {
  const modelId = model.replace(/^models\//, '')
  return /^gemini-3(?:[.-]|$)/i.test(modelId)
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

  const candidates = Array.isArray(data.candidates) ? data.candidates : []
  for (const candidate of candidates) {
    const text = extractPartsText(candidate.content?.parts)
    if (text) return text
  }
  return ''
}

function extractPartsText(parts: GeminiPart[] | undefined): string {
  if (!Array.isArray(parts)) return ''

  return parts
    .map((part) => {
      if (part?.thought === true) return ''
      if (typeof part?.text === 'string') return part.text
      return ''
    })
    .join('')
    .trim()
}
