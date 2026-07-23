import { describe, expect, it } from 'vitest';

import { FIRST_LAUNCH_DISABLED_CODE } from '@/lib/first-launch-disabled';
import { POST as postDashboardBroadcast } from './whatsapp/broadcast/route';
import { POST as postPublicMessage } from './v1/messages/route';
import {
  GET as getPublicBroadcasts,
  POST as postPublicBroadcasts,
} from './v1/broadcasts/route';
import { GET as getPublicBroadcast } from './v1/broadcasts/[id]/route';

async function expectDisabled(
  response: Response,
  feature: 'broadcasts' | 'meta_transport',
) {
  const json = await response.json();
  expect(response.status).toBe(410);
  expect(json).toMatchObject({
    error: FIRST_LAUNCH_DISABLED_CODE,
    feature,
  });
}

describe('first-launch disabled outbound API routes', () => {
  it('blocks dashboard broadcast sending', async () => {
    await expectDisabled(await postDashboardBroadcast(), 'broadcasts');
  });

  it('blocks public API message sending', async () => {
    await expectDisabled(await postPublicMessage(), 'meta_transport');
  });

  it('blocks public API broadcast creation and status reads', async () => {
    await expectDisabled(await getPublicBroadcasts(), 'broadcasts');
    await expectDisabled(await postPublicBroadcasts(), 'broadcasts');
    await expectDisabled(await getPublicBroadcast(), 'broadcasts');
  });
});
