import {
  Bot,
  Coins,
  KeyRound,
  Link2,
  LayoutGrid,
  MessageCircle,
  Palette,
  Shield,
  ShieldCheck,
  Tags,
  User,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'fields',
  'deals',
  'whatsapp',
  'amocrm',
  'ai',
  'readiness',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  labelKey: TranslationKey;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', labelKey: 'settings.overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', labelKey: 'settings.profile', icon: User, group: 'account' },
  security: { id: 'security', labelKey: 'settings.security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', labelKey: 'settings.appearance', icon: Palette, group: 'account' },
  fields: { id: 'fields', labelKey: 'settings.fields', icon: Tags, group: 'workspace' },
  deals: { id: 'deals', labelKey: 'settings.deals', icon: Coins, group: 'workspace' },
  whatsapp: { id: 'whatsapp', labelKey: 'settings.whatsapp', icon: MessageCircle, group: 'workspace' },
  amocrm: { id: 'amocrm', labelKey: 'settings.amocrm', icon: Link2, group: 'workspace' },
  ai: { id: 'ai', labelKey: 'settings.ai', icon: Bot, group: 'workspace' },
  readiness: { id: 'readiness', labelKey: 'settings.readiness', icon: ShieldCheck, group: 'workspace' },
  members: { id: 'members', labelKey: 'settings.members', icon: UsersRound, group: 'workspace' },
  api: { id: 'api', labelKey: 'settings.api', icon: KeyRound, group: 'workspace' },
};

export const RAIL_GROUPS: { labelKey: TranslationKey | null; group: SectionMeta['group'] }[] = [
  { labelKey: null, group: 'top' },
  { labelKey: 'settings.account', group: 'account' },
  { labelKey: 'common.workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
