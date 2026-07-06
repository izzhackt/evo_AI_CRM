import { describe, expect, it } from 'vitest';

import { FIRST_LAUNCH_DISABLED_CODE } from '@/lib/first-launch-disabled';

import { POST } from './route';

describe('POST /api/whatsapp/send', () => {
  it('fails closed while Meta transport is disabled for first launch', async () => {
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(410);
    expect(json).toMatchObject({
      error: FIRST_LAUNCH_DISABLED_CODE,
      feature: 'meta_transport',
    });
  });
});
