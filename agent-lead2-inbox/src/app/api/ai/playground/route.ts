import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { loadAiConfigForAccount } from '@/lib/ai/config'
import { retrieveKnowledgeWithEvidence } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { supabaseAdminClient } from '@/lib/supabase/admin-client'
import {
  AssistantAuditError,
  recordAssistantAudit,
} from '@/lib/ai/assistant-audit'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's draft assistant WITHOUT touching WhatsApp.
 * Runs knowledge-base retrieval + the draft system prompt + the configured
 * provider so staff can inspect suggested language before using it in the
 * inbox. Reads the config even when the master switch is off
 * (requireActive:false). Stateless: the client sends the running transcript
 * each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return badRequest()
    const keys = Object.keys(body).sort()
    if (keys.some((key) => !['evaluation_case_id', 'messages'].includes(key)))
      return badRequest()
    const evaluationCaseId = body.evaluation_case_id ?? null
    if (
      evaluationCaseId !== null &&
      evaluationCaseId !== 'client_china_documents'
    )
      return badRequest()
    if (
      !Array.isArray(body.messages) ||
      body.messages.length < 1 ||
      body.messages.length > MAX_TURNS
    )
      return badRequest()
    const messages: ChatMessage[] = []
    for (const item of body.messages) {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.keys(item).sort().join(',') !== 'content,role' ||
        !['user', 'assistant'].includes(item.role) ||
        typeof item.content !== 'string'
      )
        return badRequest()
      const content = item.content.trim()
      if (content.length < 1 || content.length > 4000) return badRequest()
      messages.push({ role: item.role, content })
    }

    const config = await loadAiConfigForAccount(accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      )
    }

    const retrieval = await retrieveKnowledgeWithEvidence(
      supabase,
      accountId,
      'client',
      config,
      latestUserMessage(messages)
    )
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge: retrieval.excerpts,
    })
    if (retrieval.sources.length === 0)
      throw new AiError('Не найдены управляемые источники знаний.', {
        code: 'knowledge_sources_missing',
        status: 502,
      })

    const { text, handoff } = await generateReply({
      config,
      systemPrompt,
      messages,
    })
    const auditId = await recordAssistantAudit(supabaseAdminClient(), {
      accountId,
      audience: 'client',
      evaluationCaseId,
      provider: config.provider,
      model: config.model,
      sources: retrieval.sources,
      response: text,
      handoff,
      actorUserId: userId,
    })
    return NextResponse.json({
      reply: text,
      handoff,
      sources: retrieval.sources,
      audit_id: auditId,
    })
  } catch (err) {
    if (err instanceof AssistantAuditError)
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      )
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      )
    }
    return toErrorResponse(err)
  }
}

function badRequest() {
  return NextResponse.json(
    { error: 'Некорректный запрос.', code: 'invalid_request' },
    { status: 400 }
  )
}
