import type { StaticImageData } from "next/image";

import curatorAe from "@/assets/ai-agents/curator-ae.webp";
import curatorCn from "@/assets/ai-agents/curator-cn.webp";
import curatorEu from "@/assets/ai-agents/curator-eu.webp";
import curatorMy from "@/assets/ai-agents/curator-my.webp";
import curatorTr from "@/assets/ai-agents/curator-tr.webp";
import director from "@/assets/ai-agents/director.webp";
import sales from "@/assets/ai-agents/sales.webp";

/**
 * Маскоты агентов (12.11.2026, по просьбе Айвара; нарисованы в Google Flow). Статический импорт, как у логотипа:
 * файлы идут через `/_next/static` мимо proxy. У агента без маскота — пустой круг.
 */
export const AGENT_MASCOTS: Readonly<Record<string, StaticImageData | undefined>> = {
  sales,
  director,
  "curator-cn": curatorCn,
  "curator-my": curatorMy,
  "curator-eu": curatorEu,
  "curator-ae": curatorAe,
  "curator-tr": curatorTr,
};
