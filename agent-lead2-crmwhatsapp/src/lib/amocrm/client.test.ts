import { describe, expect, it, vi } from 'vitest';

import {
  AmoCrmConfigurationError,
  createAmoCrmClient,
  normalizeAmoCrmBaseUrl,
} from './client';

describe('amoCRM client', () => {
  it('normalizes account domains into API base URLs', () => {
    expect(normalizeAmoCrmBaseUrl('evo.amocrm.ru')).toBe(
      'https://evo.amocrm.ru',
    );
    expect(normalizeAmoCrmBaseUrl('https://evo.amocrm.com/')).toBe(
      'https://evo.amocrm.com',
    );
  });

  it('reports exact missing configuration inputs', () => {
    expect(() =>
      createAmoCrmClient({
        baseUrl: '',
        accessToken: '',
      }),
    ).toThrow(AmoCrmConfigurationError);

    try {
      createAmoCrmClient({ baseUrl: '', accessToken: '' });
    } catch (err) {
      expect(err).toMatchObject({
        code: 'amocrm_not_configured',
        missingFields: ['baseUrl', 'accessToken'],
      });
    }
  });

  it('looks up contact and embedded lead by normalized phone query', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        _embedded: {
          contacts: [
            {
              id: 101,
              name: 'Alice',
              custom_fields_values: [
                {
                  field_code: 'PHONE',
                  values: [{ value: '+1 415 555 1212' }],
                },
              ],
              _embedded: { leads: [{ id: 202, is_main: true }] },
            },
          ],
        },
      }),
    );
    const client = createAmoCrmClient(
      {
        baseUrl: 'https://evo.amocrm.ru',
        accessToken: 'access-token',
      },
      fetchMock,
    );

    const contact = await client.findContactByPhone('+1 (415) 555-1212');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evo.amocrm.ru/api/v4/contacts?query=14155551212&with=leads',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      }),
    );
    expect(contact).toMatchObject({
      id: '101',
      name: 'Alice',
      leadId: '202',
    });
  });

  it('does not bind identity to a broad-search contact without matching phone', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        _embedded: {
          contacts: [
            {
              id: 101,
              name: 'Wrong Alice',
              custom_fields_values: [
                {
                  field_code: 'PHONE',
                  values: [{ value: '+1 999 555 1212' }],
                },
              ],
              _embedded: { leads: [{ id: 202, is_main: true }] },
            },
            {
              id: 102,
              name: 'No Phone Match',
              custom_fields_values: [],
            },
          ],
        },
      }),
    );
    const client = createAmoCrmClient(
      {
        baseUrl: 'https://evo.amocrm.ru',
        accessToken: 'access-token',
      },
      fetchMock,
    );

    await expect(client.findContactByPhone('+1 (415) 555-1212')).resolves.toBeNull();
  });

  it('creates contacts and leads with amoCRM v4 payload contracts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          _embedded: { contacts: [{ id: 101, name: 'Alice' }] },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          _embedded: { leads: [{ id: 202, name: 'WhatsApp - Alice' }] },
        }),
      );
    const client = createAmoCrmClient(
      {
        baseUrl: 'evo.amocrm.ru',
        accessToken: 'access-token',
        pipelineId: 333,
        statusId: 444,
      },
      fetchMock,
    );

    const contact = await client.createContact({
      phone: '+1 (415) 555-1212',
      name: 'Alice',
    });
    const lead = await client.createLead({
      contactId: contact.id,
      name: 'WhatsApp - Alice',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://evo.amocrm.ru/api/v4/contacts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([
          {
            name: 'Alice',
            custom_fields_values: [
              {
                field_code: 'PHONE',
                values: [{ value: '+14155551212', enum_code: 'WORK' }],
              },
            ],
          },
        ]),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://evo.amocrm.ru/api/v4/leads',
      expect.objectContaining({ method: 'POST' }),
    );
    const leadRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(leadRequest.body))).toEqual([
      {
        name: 'WhatsApp - Alice',
        pipeline_id: 333,
        status_id: 444,
        _embedded: { contacts: [{ id: 101, is_main: true }] },
      },
    ]);
    expect(lead.id).toBe('202');
  });

  it('surfaces provider failures without hiding them as local success', async () => {
    const client = createAmoCrmClient(
      {
        baseUrl: 'evo.amocrm.ru',
        accessToken: 'access-token',
      },
      vi.fn(async () =>
        Response.json({ title: 'provider down' }, { status: 503 }),
      ),
    );

    await expect(client.findContactByPhone('+14155551212')).rejects.toMatchObject({
      code: 'amocrm_provider_error',
      status: 503,
    });
  });
});
