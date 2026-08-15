import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { integrationsAdminClient } from '@/lib/integrations/admin-client'
import { loadAiConfigForAccount } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { recordAiDraftAudit } from '@/lib/ai/draft-audit'
import { retrieveKnowledgeWithEvidence } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/draft  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { draft, draft_id } — a suggested reply for the agent to edit +
 * send, plus its immutable audit identifier.
 *
 * Uses the account's configured provider/key (BYO). It never sends a
 * WhatsApp message. The generated text is returned only after its operator,
 * provider, model, and knowledge evidence have been stored for audit.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-draft:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    // Also cap the whole team's draws on the shared BYO provider key.
    const accountLimit = checkRateLimit(`ai-draft-acct:${accountId}`, RATE_LIMITS.aiDraftAccount)
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    if (body && typeof body === 'object' && 'audience' in body) {
      return NextResponse.json({ error: 'audience is controlled by the server' }, { status: 400 })
    }
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }

    // RLS scopes the SSR client to the caller's account, so a missing
    // row means "not yours / not found" either way.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/draft] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfigForAccount(accountId).catch((err) => {
      // Secret reads happen through the account-scoped admin store.
      // Decrypt failure should surface distinctly from "not configured".
      console.error('[ai/draft] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'AI assistant is not set up. Enable it in Settings → AI Assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId)
    // Nothing to draft from — a brand-new thread with no customer text
    // would otherwise produce a nonsensical reply-to-nothing.
    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: 'No messages to draft from yet.',
          code: 'no_messages',
        },
        { status: 400 },
      )
    }

    // Ground the draft in the account's knowledge base (best-effort —
    // returns [] when there's no KB or retrieval fails).
    const knowledge = await retrieveKnowledgeWithEvidence(
      supabase,
      accountId,
      'client',
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge: knowledge.excerpts,
    })

    const { text } = await generateReply({ config, systemPrompt, messages })
    let draftId: string
    try {
      draftId = await recordAiDraftAudit(integrationsAdminClient(), {
        accountId,
        conversationId,
        createdBy: userId,
        provider: config.provider,
        model: config.model,
        contentText: text,
        knowledgeChunkIds: knowledge.chunkIds,
      })
    } catch (err) {
      console.error('[ai/draft] audit persistence failed:', err)
      throw new AiError('The AI draft could not be saved for operator review. Please try again.', {
        code: 'ai_draft_audit_failed',
        status: 503,
      })
    }

    return NextResponse.json({ draft: text, draft_id: draftId })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
