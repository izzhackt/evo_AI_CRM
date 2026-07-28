import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  deleteAiConfig,
  getAiConfigSummary,
  getStoredAiConfig,
  upsertAiConfig,
} from '@/lib/ai/admin-store'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { isEmbeddingsProvider } from '@/lib/ai/config'
import { AiError, type AiProvider, type EmbeddingsProvider } from '@/lib/ai/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

type SemanticEmbeddingsProvider = Exclude<EmbeddingsProvider, 'keyword'>

function resolveEmbeddingsCredential(args: {
  embeddingsProvider: EmbeddingsProvider
  provider: AiProvider
  apiKeyPlain: string
  rawEmbeddingsKey: string
  clearEmbeddingsKey: boolean
  existingEmbeddingsProvider: EmbeddingsProvider
  existingEmbeddingsKeyCiphertext: string | null
}):
  | { config: { provider: SemanticEmbeddingsProvider; apiKey: string } | null }
  | { error: string } {
  const {
    embeddingsProvider,
    provider,
    apiKeyPlain,
    rawEmbeddingsKey,
    clearEmbeddingsKey,
    existingEmbeddingsProvider,
    existingEmbeddingsKeyCiphertext,
  } = args

  if (embeddingsProvider === 'keyword') return { config: null }

  if (rawEmbeddingsKey) {
    return { config: { provider: embeddingsProvider, apiKey: rawEmbeddingsKey } }
  }

  if (
    !clearEmbeddingsKey &&
    existingEmbeddingsKeyCiphertext &&
    existingEmbeddingsProvider === embeddingsProvider
  ) {
    try {
      return {
        config: {
          provider: embeddingsProvider,
          apiKey: decrypt(existingEmbeddingsKeyCiphertext),
        },
      }
    } catch {
      return {
        error:
          'Stored embeddings key could not be decrypted — re-enter the embeddings key.',
      }
    }
  }

  if (provider === embeddingsProvider) {
    return { config: { provider: embeddingsProvider, apiKey: apiKeyPlain } }
  }

  const label = embeddingsProvider === 'gemini' ? 'Gemini' : 'OpenAI'
  return {
    error: `${label} embeddings require a ${label} API key. Enter an embeddings override key or switch the draft provider to ${label}.`,
  }
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const data = await getAiConfigSummary(accountId)
    if (!data) return NextResponse.json({ configured: false })
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
      embeddings_provider: safe.embeddings_provider ?? 'keyword',
      auto_reply_enabled: false,
      auto_reply_max_per_conversation: 1,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const provider = body.provider as AiProvider
    if (
      provider !== 'openai' &&
      provider !== 'anthropic' &&
      provider !== 'gemini'
    ) {
      return bad('provider must be "openai", "anthropic", or "gemini"')
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = false
    const maxPer = 1

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    const requestedEmbeddingsProvider = body.embeddings_provider
    if (
      requestedEmbeddingsProvider !== undefined &&
      !isEmbeddingsProvider(requestedEmbeddingsProvider)
    ) {
      return bad('embeddings_provider must be "keyword", "gemini", or "openai"')
    }

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    // Reuse the stored key when the form didn't send a fresh one.
    const existing = await getStoredAiConfig(accountId)

    const existingEmbeddingsProvider = isEmbeddingsProvider(
      existing?.embeddings_provider,
    )
      ? existing.embeddings_provider
      : 'keyword'
    const embeddingsProvider =
      requestedEmbeddingsProvider ?? existingEmbeddingsProvider

    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    } else {
      return bad('api_key is required')
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          embeddingsProvider,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 }
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    const embeddingsResolution = resolveEmbeddingsCredential({
      embeddingsProvider,
      provider,
      apiKeyPlain,
      rawEmbeddingsKey,
      clearEmbeddingsKey,
      existingEmbeddingsProvider,
      existingEmbeddingsKeyCiphertext:
        typeof existing?.embeddings_api_key === 'string'
          ? existing.embeddings_api_key
          : null,
    })
    if ('error' in embeddingsResolution) return bad(embeddingsResolution.error)

    // Validate semantic embeddings when the setting or credentials that
    // feed it changed. Keyword-only mode intentionally makes no provider
    // call.
    const embeddingsChanged =
      !existing ||
      embeddingsProvider !== existingEmbeddingsProvider ||
      rawEmbeddingsKey !== '' ||
      clearEmbeddingsKey ||
      (credentialsChanged && embeddingsProvider === provider)

    if (
      embeddingsResolution.config &&
      embeddingsChanged
    ) {
      try {
        await embedTexts(embeddingsResolution.config, ['ping'], 'validation')
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 }
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared: Record<string, unknown> = {
      provider,
      model,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
      embeddings_provider: embeddingsProvider,
    }
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (
      clearEmbeddingsKey ||
      (embeddingsProvider !== existingEmbeddingsProvider &&
        embeddingsProvider === provider)
    ) {
      shared.embeddings_api_key = null
    }

    if (existing) {
      const { error } = await upsertAiConfig(
        accountId,
        userId,
        existing.id,
        encryptedKey ? { ...shared, api_key: encryptedKey } : shared,
      )
      if (error) {
        console.error('[ai/config POST] update error:', error)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 }
        )
      }
    } else {
      const { error } = await upsertAiConfig(accountId, userId, null, {
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      })
      if (error) {
        console.error('[ai/config POST] insert error:', error)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    const { error } = await deleteAiConfig(accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI configuration' },
        { status: 500 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
