import type { TeamChatMessage } from "./platform-team-chat.ts";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "./platform-organization-time.ts";

type GroupingMessage = Pick<TeamChatMessage, "id" | "channelKey" | "authorMembershipId" | "createdAt" | "sequence" | "deletedAt">;
type GroupingBoundaries = Readonly<{ highlightedId?: string | null; firstUnreadId?: string | null }>;

const MAX_INTERVAL_MS = 5 * 60 * 1000;
const organizationDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

/** Presentation only: use the visible range, never cached rows outside it. */
export function teamChatMessageContinuations(rows: readonly GroupingMessage[], boundaries: GroupingBoundaries = {}): boolean[] {
  return rows.map((message, index) => {
    const previous = rows[index - 1];
    if (!previous || message.id === boundaries.highlightedId || message.id === boundaries.firstUnreadId) return false;
    if (message.deletedAt || previous.deletedAt || message.channelKey !== previous.channelKey || message.authorMembershipId !== previous.authorMembershipId) return false;
    if (!/^\d+$/u.test(previous.sequence) || !/^\d+$/u.test(message.sequence)) return false;
    if (BigInt(message.sequence) !== BigInt(previous.sequence) + BigInt(1)) return false;

    const previousTime = Date.parse(previous.createdAt);
    const currentTime = Date.parse(message.createdAt);
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return false;
    const interval = currentTime - previousTime;
    return interval >= 0 && interval <= MAX_INTERVAL_MS && organizationDay.format(previousTime) === organizationDay.format(currentTime);
  });
}
