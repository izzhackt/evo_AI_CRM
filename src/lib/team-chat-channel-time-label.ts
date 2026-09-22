import { PLATFORM_ORGANIZATION_TIMEZONE } from "./platform-organization-time.ts";
import { normalizeTeamChatPreviewCreatedAt } from "./team-chat-channel-preview-time.ts";

const channelTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  calendar: "gregory",
  numberingSystem: "latn",
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
  hourCycle: "h23",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "longOffset",
});

export function formatTeamChatChannelTime(value: unknown): {
  dateTime: string; label: string; fullLabel: string;
} | null {
  const dateTime = normalizeTeamChatPreviewCreatedAt(value);
  if (dateTime === null) return null;

  // Display minutes from whole seconds; retain every microsecond in dateTime.
  const date = new Date(`${dateTime.slice(0, 19)}Z`);
  const parts = Object.fromEntries(channelTimeFormat.formatToParts(date).map(({ type, value: part }) => [type, part]));
  const dayMonth = `${parts.day}.${parts.month}`;
  const clock = `${parts.hour}:${parts.minute}`;
  return {
    dateTime,
    label: `${dayMonth} ${clock}`,
    fullLabel: `Последнее сообщение: ${dayMonth}.${parts.year.padStart(4, "0")} ${clock} (${parts.timeZoneName})`,
  };
}
