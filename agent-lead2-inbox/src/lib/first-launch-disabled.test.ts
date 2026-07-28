import { describe, expect, it } from 'vitest';

import {
  FIRST_LAUNCH_DISABLED_CODE,
  FIRST_LAUNCH_DISABLED_STATUS,
  firstLaunchDisabledPayload,
  resolveFirstLaunchDisabledPath,
} from './first-launch-disabled';

describe('first-launch disabled route map', () => {
  it.each([
    ['/api/whatsapp/send', 'meta_transport'],
    ['/api/whatsapp/media/example-media-id', 'meta_transport'],
    ['/api/whatsapp/react', 'meta_transport'],
    ['/api/v1/messages', 'meta_transport'],
    ['/api/whatsapp/webhook', 'meta_transport'],
    ['/api/whatsapp/templates/sync', 'meta_templates'],
    ['/api/whatsapp/templates/submit', 'meta_templates'],
    ['/api/whatsapp/templates/example-template-id', 'meta_templates'],
  ])('blocks Meta transport or template path %s', (pathname, feature) => {
    expect(resolveFirstLaunchDisabledPath(pathname)).toEqual({
      feature,
      surface: 'api',
    });
  });

  it.each([
    ['/api/whatsapp/broadcast', 'broadcasts'],
    ['/api/v1/broadcasts', 'broadcasts'],
    ['/api/v1/broadcasts/abc123', 'broadcasts'],
  ])('blocks broadcast send/status path %s', (pathname, feature) => {
    expect(resolveFirstLaunchDisabledPath(pathname)).toEqual({
      feature,
      surface: 'api',
    });
  });

  it.each([
    ['/api/automations', 'automations'],
    ['/api/automations/cron', 'automations'],
    ['/api/automations/engine', 'automations'],
    ['/api/flows', 'flows'],
    ['/api/flows/cron', 'flows'],
    ['/api/flows/abc123/activate', 'flows'],
  ])('blocks automation or flow-driven scheduling path %s', (pathname, feature) => {
    expect(resolveFirstLaunchDisabledPath(pathname)).toEqual({
      feature,
      surface: 'api',
    });
  });

  it.each([
    ['/broadcasts', 'broadcasts'],
    ['/broadcasts/new', 'broadcasts'],
    ['/automations', 'automations'],
    ['/automations/new', 'automations'],
    ['/flows', 'flows'],
    ['/flows/abc123/runs', 'flows'],
  ])('blocks disabled product page %s', (pathname, feature) => {
    expect(resolveFirstLaunchDisabledPath(pathname)).toEqual({
      feature,
      surface: 'page',
    });
  });

  it('does not block retained first-launch surfaces', () => {
    expect(resolveFirstLaunchDisabledPath('/inbox')).toBeNull();
    expect(resolveFirstLaunchDisabledPath('/contacts')).toBeNull();
    expect(resolveFirstLaunchDisabledPath('/pipelines')).toBeNull();
    expect(resolveFirstLaunchDisabledPath('/agents')).toBeNull();
    expect(resolveFirstLaunchDisabledPath('/api/ai/draft')).toBeNull();
    expect(resolveFirstLaunchDisabledPath('/api/ai/knowledge')).toBeNull();
    expect(resolveFirstLaunchDisabledPath('/api/whatsapp/config')).toBeNull();
  });

  it('uses a fail-closed payload and status for disabled modules', () => {
    expect(FIRST_LAUNCH_DISABLED_STATUS).toBe(410);
    expect(firstLaunchDisabledPayload('broadcasts')).toMatchObject({
      error: FIRST_LAUNCH_DISABLED_CODE,
      feature: 'broadcasts',
    });
  });
});
