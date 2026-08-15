import { NextResponse } from 'next/server'

import {
  AssistantAuditError,
  recordAssistantAudit,
} from '@/lib/ai/assistant-audit'
import { loadAiConfigForAccount } from '@/lib/ai/config'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { generateReply } from '@/lib/ai/generate'
import { retrieveKnowledgeWithEvidence } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { supabaseAdminClient } from '@/lib/supabase/admin-client'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`ai-internal:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return badRequest()
    if (
      Object.keys(body).some(
        (key) => !['evaluation_case_id', 'message'].includes(key)
      )
    )
      return badRequest()
    const evaluationCaseId = body.evaluation_case_id ?? null
    if (
      evaluationCaseId !== null &&
      evaluationCaseId !== 'internal_malaysia_handoff'
    )
      return badRequest()
    if (typeof body.message !== 'string') return badRequest()
    const message = body.message.trim()
    if (message.length < 1 || message.length > 4000) return badRequest()

    const config = await loadAiConfigForAccount(accountId, {
      requireActive: false,
    }).catch(() => {
      throw new AiError('Ключ AI не расшифрован.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config)
      throw new AiError('AI не настроен.', {
        code: 'ai_not_configured',
        status: 400,
      })

    const retrieval = await retrieveKnowledgeWithEvidence(
      supabase,
      accountId,
      'internal',
      config,
      message
    )
    if (retrieval.sources.length === 0)
      throw new AiError('Не найдены управляемые внутренние источники.', {
        code: 'knowledge_sources_missing',
        status: 502,
      })
    const systemPrompt = buildSystemPrompt({
      userPrompt:
        'Ты внутренний помощник сотрудников EVO Admissions. Отвечай по-русски только по внутренней базе знаний. Не отправляй сообщения клиентам и отмечай необходимость передачи человеку.',
      mode: 'draft',
      knowledge: retrieval.excerpts,
    })
    const { text, handoff } = await generateReply({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: message }],
    })
    const auditId = await recordAssistantAudit(supabaseAdminClient(), {
      accountId,
      audience: 'internal',
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
  } catch (error) {
    if (error instanceof AssistantAuditError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    if (error instanceof AiError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    return toErrorResponse(error)
  }
}

function badRequest() {
  return NextResponse.json(
    { error: 'Некорректный запрос.', code: 'invalid_request' },
    { status: 400 }
  )
}
