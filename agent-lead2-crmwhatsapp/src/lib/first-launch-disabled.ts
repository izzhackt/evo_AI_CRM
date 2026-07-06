export const FIRST_LAUNCH_DISABLED_STATUS = 410;

export const FIRST_LAUNCH_DISABLED_CODE = 'first_launch_disabled';

export type FirstLaunchDisabledFeature =
  | 'meta_transport'
  | 'meta_templates'
  | 'broadcasts'
  | 'automations'
  | 'flows'
  | 'auto_reply';

export interface FirstLaunchDisabledMatch {
  feature: FirstLaunchDisabledFeature;
  surface: 'api' | 'page';
}

const DISABLED_API_PREFIXES: Array<{
  prefix: string;
  feature: FirstLaunchDisabledFeature;
}> = [
  { prefix: '/api/whatsapp/config', feature: 'meta_transport' },
  { prefix: '/api/whatsapp/media', feature: 'meta_transport' },
  { prefix: '/api/whatsapp/react', feature: 'meta_transport' },
  { prefix: '/api/whatsapp/send', feature: 'meta_transport' },
  { prefix: '/api/whatsapp/webhook', feature: 'meta_transport' },
  { prefix: '/api/whatsapp/templates', feature: 'meta_templates' },
  { prefix: '/api/whatsapp/broadcast', feature: 'broadcasts' },
  { prefix: '/api/v1/messages', feature: 'meta_transport' },
  { prefix: '/api/v1/broadcasts', feature: 'broadcasts' },
  { prefix: '/api/automations', feature: 'automations' },
  { prefix: '/api/flows', feature: 'flows' },
];

const DISABLED_PAGE_PREFIXES: Array<{
  prefix: string;
  feature: FirstLaunchDisabledFeature;
}> = [
  { prefix: '/broadcasts', feature: 'broadcasts' },
  { prefix: '/automations', feature: 'automations' },
  { prefix: '/flows', feature: 'flows' },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolveFirstLaunchDisabledPath(
  pathname: string,
): FirstLaunchDisabledMatch | null {
  const apiMatch = DISABLED_API_PREFIXES.find(({ prefix }) =>
    matchesPrefix(pathname, prefix),
  );
  if (apiMatch) {
    return { feature: apiMatch.feature, surface: 'api' };
  }

  const pageMatch = DISABLED_PAGE_PREFIXES.find(({ prefix }) =>
    matchesPrefix(pathname, prefix),
  );
  if (pageMatch) {
    return { feature: pageMatch.feature, surface: 'page' };
  }

  return null;
}

export function firstLaunchDisabledPayload(feature: FirstLaunchDisabledFeature) {
  return {
    error: FIRST_LAUNCH_DISABLED_CODE,
    feature,
    message:
      'This surface is intentionally disabled for the first EVO Inbox launch. Meta Cloud API, templates, broadcasts, automations, flow-driven sends, and auto-reply are out of scope until later slices replace the transport with WAHA and prove manual operator workflows.',
  };
}
