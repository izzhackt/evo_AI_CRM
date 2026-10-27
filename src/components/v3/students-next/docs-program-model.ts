import type { ApplicationDocumentQueueItem } from "@/lib/portal/application-documents";

import { formatQueueDay } from "../queue/due-bucket";

export const programOf = (item: ApplicationDocumentQueueItem) => [item.universityTitle, item.programTitle].filter(Boolean).join(" · ");

/** Срок требования: короткий («25.09 14:00») и полный с поясом — для подсказки. */
export function deadlineText(deadline: NonNullable<ApplicationDocumentQueueItem["deadline"]>, today: string): Readonly<{ short: string; full: string }> {
  const day = formatQueueDay(deadline.date, today);
  return {
    short: deadline.time ? `${day} ${deadline.time}` : day,
    full: `${deadline.date.split("-").reverse().join(".")}${deadline.time ? `, ${deadline.time}` : ""}${deadline.timezone ? ` (${deadline.timezone})` : ""}`,
  };
}
