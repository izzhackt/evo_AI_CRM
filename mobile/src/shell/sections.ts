// Разделы кабинета и доступ по уровню: порт SECTIONS из
// src/components/portal/Shell.tsx (веб #1412). Чистые данные, без React.
import type { AccessTier } from "@/session/access";

export type SectionId =
  | "home"
  | "documents"
  | "payments"
  | "messages"
  | "universities"
  | "professions"
  | "english"
  | "csca"
  | "tests"
  | "profile";

export type NavKey =
  | "nav.home"
  | "nav.documents"
  | "nav.payments"
  | "nav.messages"
  | "nav.universities"
  | "nav.professions"
  | "nav.english"
  | "nav.csca"
  | "nav.tests"
  | "nav.profile";

export type SectionGroup = "choice" | "prep" | null;

export type Section = Readonly<{
  id: SectionId;
  navKey: NavKey;
  /** Имя Lucide-иконки (см. icons.ts). */
  icon: string;
  tiers: readonly AccessTier[];
  group: SectionGroup;
  /** Срез плана, в котором раздел получит содержимое (docs/mobile/PLAN.md). */
  milestone: "M1" | "M2" | "M3" | "M4" | "M5" | "M6";
}>;

const BOTH = ["approved", "assisted"] as const;
const ASSISTED = ["assisted"] as const;

export const SECTIONS: readonly Section[] = [
  { id: "home", navKey: "nav.home", icon: "House", tiers: BOTH, group: null, milestone: "M1" },
  { id: "documents", navKey: "nav.documents", icon: "FileText", tiers: ASSISTED, group: null, milestone: "M2" },
  { id: "payments", navKey: "nav.payments", icon: "Wallet", tiers: ASSISTED, group: null, milestone: "M2" },
  { id: "messages", navKey: "nav.messages", icon: "MessagesSquare", tiers: ASSISTED, group: null, milestone: "M3" },
  { id: "universities", navKey: "nav.universities", icon: "Landmark", tiers: BOTH, group: "choice", milestone: "M4" },
  { id: "professions", navKey: "nav.professions", icon: "BriefcaseBusiness", tiers: BOTH, group: "choice", milestone: "M4" },
  { id: "english", navKey: "nav.english", icon: "Languages", tiers: BOTH, group: "prep", milestone: "M5" },
  { id: "csca", navKey: "nav.csca", icon: "NotebookPen", tiers: BOTH, group: "prep", milestone: "M5" },
  { id: "tests", navKey: "nav.tests", icon: "ListChecks", tiers: BOTH, group: "prep", milestone: "M5" },
  { id: "profile", navKey: "nav.profile", icon: "CircleUserRound", tiers: BOTH, group: null, milestone: "M6" },
];

/** Три вкладки телефона (PHONE_TABS в Shell.tsx, #1355: «Поступления» больше нет). */
export const PHONE_TABS: readonly SectionId[] = ["home", "documents", "messages"];

export const allowedFor = (tier: AccessTier): readonly Section[] => SECTIONS.filter((s) => s.tiers.includes(tier));

/** Вкладки нижней панели: у approved остаётся одна «Главная». */
export const tabsFor = (tier: AccessTier): readonly Section[] =>
  allowedFor(tier).filter((s) => PHONE_TABS.includes(s.id));

/** Одна вкладка — не панель (Shell.tsx: `tabSections.length > 1`): у approved панель не рисуется, остаётся ☰. */
export const hasTabBar = (tier: AccessTier): boolean => tabsFor(tier).length > 1;

export const isAllowed = (id: SectionId, tier: AccessTier): boolean =>
  SECTIONS.some((s) => s.id === id && s.tiers.includes(tier));

export type MenuBlock = Readonly<{ group: SectionGroup; sections: readonly Section[] }>;

/**
 * Пункты меню ☰: все разделы уровня, с подписями групп «Выбор» и «Учёба»;
 * «Профиль» закрывает список (на телефоне карточки аккаунта нет).
 */
export function menuFor(tier: AccessTier): readonly MenuBlock[] {
  const list = allowedFor(tier);
  const blocks: MenuBlock[] = [];
  const top = list.filter((s) => s.group === null && s.id !== "profile");
  if (top.length) blocks.push({ group: null, sections: top });
  for (const group of ["choice", "prep"] as const) {
    const sections = list.filter((s) => s.group === group);
    if (sections.length) blocks.push({ group, sections });
  }
  const profile = list.filter((s) => s.id === "profile");
  if (profile.length) blocks.push({ group: null, sections: profile });
  return blocks;
}
