import { describe, expect, it, vi } from 'vitest';

import {
  AmoCrmIdentityError,
  persistAmoCrmShadowIdentity,
  resolveAmoCrmIdentity,
} from './identity';
import type { AmoCrmClient } from './client';

describe('amoCRM identity resolver', () => {
  it('uses an existing amoCRM contact and lead before persisting shadow ids', async () => {
    const client = {
      findContactByPhone: vi.fn(async () => ({
        id: '101',
        name: 'Alice',
        leadId: '202',
      })),
      createContact: vi.fn(),
      createLead: vi.fn(),
    } as unknown as AmoCrmClient;
    const persist = vi.fn(async () => undefined);

    const identity = await resolveAmoCrmIdentity({
      accountId: 'acct-1',
      phone: '+14155551212',
      name: 'Alice',
      localContactId: 'contact-local',
      localConversationId: 'conversation-local',
      client,
      persist,
    });

    expect(client.createContact).not.toHaveBeenCalled();
    expect(client.createLead).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith({
      accountId: 'acct-1',
      localContactId: 'contact-local',
      localConversationId: 'conversation-local',
      amoContactId: '101',
      amoLeadId: '202',
    });
    expect(identity).toEqual({ amoContactId: '101', amoLeadId: '202' });
  });

  it('creates the missing contact and lead through amoCRM before local shadow persistence', async () => {
    const client = {
      findContactByPhone: vi.fn(async () => null),
      createContact: vi.fn(async () => ({ id: '101', name: 'Alice' })),
      createLead: vi.fn(async () => ({ id: '202', name: 'WhatsApp - Alice' })),
    } as unknown as AmoCrmClient;
    const persist = vi.fn(async () => undefined);

    await resolveAmoCrmIdentity({
      accountId: 'acct-1',
      phone: '+14155551212',
      name: 'Alice',
      localContactId: 'contact-local',
      localConversationId: 'conversation-local',
      client,
      persist,
    });

    expect(client.createContact).toHaveBeenCalledWith({
      phone: '+14155551212',
      name: 'Alice',
    });
    expect(client.createLead).toHaveBeenCalledWith({
      contactId: '101',
      name: 'WhatsApp - Alice',
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('fails clearly and does not persist a local-only real lead on provider failure', async () => {
    const client = {
      findContactByPhone: vi.fn(async () => {
        throw Object.assign(new Error('amoCRM unavailable'), {
          code: 'amocrm_provider_error',
        });
      }),
    } as unknown as AmoCrmClient;
    const persist = vi.fn(async () => undefined);

    await expect(
      resolveAmoCrmIdentity({
        accountId: 'acct-1',
        phone: '+14155551212',
        name: 'Alice',
        localContactId: 'contact-local',
        localConversationId: 'conversation-local',
        client,
        persist,
      }),
    ).rejects.toMatchObject({
      code: 'amocrm_identity_resolution_failed',
    } satisfies Partial<AmoCrmIdentityError>);
    expect(persist).not.toHaveBeenCalled();
  });

  it('writes amo_contact_id and amo_lead_id shadow fields to Supabase', async () => {
    const calls: unknown[] = [];
    const builder = {
      update(value: unknown) {
        calls.push(['update', value]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push(['eq', column, value]);
        return builder;
      },
      then(resolve: (value: { error: null }) => void) {
        resolve({ error: null });
      },
    };
    const db = {
      from(table: string) {
        calls.push(['from', table]);
        return builder;
      },
    };

    await persistAmoCrmShadowIdentity(db, {
      accountId: 'acct-1',
      localContactId: 'contact-local',
      localConversationId: 'conversation-local',
      amoContactId: '101',
      amoLeadId: '202',
    });

    expect(calls).toContainEqual(['from', 'contacts']);
    expect(calls).toContainEqual(['from', 'conversations']);
    expect(calls).toContainEqual([
      'update',
      expect.objectContaining({ amo_contact_id: '101' }),
    ]);
    expect(calls).toContainEqual([
      'update',
      expect.objectContaining({ amo_lead_id: '202' }),
    ]);
    expect(calls).toContainEqual(['eq', 'account_id', 'acct-1']);
  });
});
