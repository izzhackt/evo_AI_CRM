import type { AmoCrmClient } from './client';

export interface AmoCrmIdentity {
  amoContactId: string;
  amoLeadId: string;
}

export interface PersistAmoCrmShadowInput extends AmoCrmIdentity {
  accountId: string;
  localContactId: string;
  localConversationId: string;
}

export class AmoCrmIdentityError extends Error {
  readonly code = 'amocrm_identity_resolution_failed';
  readonly status = 502;
  readonly causeCode?: string;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AmoCrmIdentityError';
    if (cause && typeof cause === 'object' && 'code' in cause) {
      this.causeCode = String((cause as { code: unknown }).code);
    }
  }
}

interface ShadowDb {
  from(table: string): {
    update(value: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): unknown;
      };
    };
  };
}

export async function resolveAmoCrmIdentity(input: {
  accountId: string;
  phone: string;
  name?: string | null;
  localContactId: string;
  localConversationId: string;
  client: AmoCrmClient;
  persist: (identity: PersistAmoCrmShadowInput) => Promise<void>;
}): Promise<AmoCrmIdentity> {
  try {
    let contact = await input.client.findContactByPhone(input.phone);
    if (!contact) {
      contact = await input.client.createContact({
        phone: input.phone,
        name: input.name ?? null,
      });
    }

    let amoLeadId = contact.leadId ?? null;
    if (!amoLeadId) {
      const label = input.name?.trim() || input.phone;
      const lead = await input.client.createLead({
        contactId: contact.id,
        name: `WhatsApp - ${label}`,
      });
      amoLeadId = lead.id;
    }

    const identity = {
      accountId: input.accountId,
      localContactId: input.localContactId,
      localConversationId: input.localConversationId,
      amoContactId: contact.id,
      amoLeadId,
    };

    await input.persist(identity);

    return {
      amoContactId: contact.id,
      amoLeadId,
    };
  } catch (err) {
    if (err instanceof AmoCrmIdentityError) throw err;
    throw new AmoCrmIdentityError('amoCRM identity resolution failed', err);
  }
}

export async function persistAmoCrmShadowIdentity(
  db: ShadowDb,
  input: PersistAmoCrmShadowInput,
): Promise<void> {
  const now = new Date().toISOString();
  const contactResult = await db
    .from('contacts')
    .update({
      amo_contact_id: input.amoContactId,
      amo_contact_synced_at: now,
      updated_at: now,
    })
    .eq('id', input.localContactId)
    .eq('account_id', input.accountId);

  if (hasSupabaseError(contactResult)) {
    throw new AmoCrmIdentityError('Failed to persist amoCRM contact shadow id');
  }

  const conversationResult = await db
    .from('conversations')
    .update({
      amo_lead_id: input.amoLeadId,
      amo_lead_synced_at: now,
      updated_at: now,
    })
    .eq('id', input.localConversationId)
    .eq('account_id', input.accountId);

  if (hasSupabaseError(conversationResult)) {
    throw new AmoCrmIdentityError('Failed to persist amoCRM lead shadow id');
  }
}

function hasSupabaseError(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    (value as { error: unknown }).error != null
  );
}
