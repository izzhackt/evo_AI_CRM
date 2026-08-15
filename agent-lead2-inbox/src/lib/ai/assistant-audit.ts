import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { AiProvider } from './types'

export interface AssistantSource {
  chunk_id: string
  source_path: string
}

export class AssistantAuditError extends Error {
  readonly code = 'assistant_audit_failed'
  readonly status = 502

  constructor() {
    super('Черновик создан, но безопасный аудит не сохранился.')
    this.name = 'AssistantAuditError'
  }
}

export async function recordAssistantAudit(
  db: SupabaseClient,
  input: {
    accountId: string
    audience: 'client' | 'internal'
    evaluationCaseId: string | null
    provider: AiProvider
    model: string
    sources: AssistantSource[]
    response: string
    handoff: boolean
    actorUserId: string
  }
): Promise<string> {
  const { data, error } = await db
    .from('ai_assistant_audits')
    .insert({
      account_id: input.accountId,
      audience: input.audience,
      evaluation_case_id: input.evaluationCaseId,
      provider: input.provider,
      model: input.model,
      knowledge_sources: input.sources,
      response_sha256: createHash('sha256')
        .update(input.response, 'utf8')
        .digest('hex'),
      handoff: input.handoff,
      success: true,
      actor_user_id: input.actorUserId,
    })
    .select('id')
    .single()
  if (error || !data?.id) throw new AssistantAuditError()
  return String(data.id)
}
