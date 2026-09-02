import "server-only";

import { getPostgresClient } from "@/lib/server/database";

import type { InboxThread } from "@/components/v3/Inbox";

/**
 * Диалоги и переписка.
 *
 * Два запроса, а не N+1: диалоги и все их сообщения приходят разом и
 * склеиваются здесь. Отдельный запрос на каждую переписку дал бы столько
 * обращений, сколько диалогов.
 *
 * ВАЖНО про то, что видно на экране. В базе сейчас только входящие сообщения:
 * исходящих нет ни одного, и `evo_whatsapp_send_attempts` пуста. Это не
 * недоделка интерфейса, а состояние продукта — людям написали, им не ответили.
 * Поэтому в переписке не нужно рисовать «наш» пузырь: его неоткуда взять.
 */
export async function readInbox(): Promise<readonly InboxThread[]> {
  const sql = getPostgresClient();

  const threads = await sql<
    {
      id: string;
      channel: string;
      status: string;
      owning_role: string;
      person: string | null;
      lead_id: string | null;
      stage: string | null;
    }[]
  >`
    select c.id, c.channel, c.status, c.owning_role,
           p.full_name as person, c.lead_id, l.stage
    from evo_conversations c
    left join evo_leads l on l.id = c.lead_id
    left join evo_people p on p.id = l.person_id
    order by c.created_at asc
  `;

  const messages = await sql<
    {
      id: string;
      conversation_id: string;
      direction: string;
      body: string | null;
      at: string | null;
    }[]
  >`
    select m.id, m.conversation_id, m.direction, m.body,
           to_char(m.occurred_at, 'DD.MM HH24:MI') as at
    from evo_messages m
    order by m.occurred_at asc
  `;

  return threads.map((thread) => {
    const own = messages.filter((m) => m.conversation_id === thread.id);
    return {
      id: thread.id,
      person: thread.person ?? "Контакт без имени",
      channel: thread.channel,
      status: thread.status,
      role: thread.owning_role,
      stage: thread.stage,
      leadHref: thread.lead_id ? `/sales/${thread.lead_id}` : null,
      messages: own.map((m) => ({
        id: m.id,
        inbound: m.direction === "inbound",
        body: m.body ?? "",
        at: m.at,
      })),
    } satisfies InboxThread;
  });
}
