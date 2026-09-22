/** Strict wire timestamp, normalized without losing PostgreSQL microseconds. */
export function normalizeTeamChatPreviewCreatedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[1].startsWith("0000-")) return null;
  // Parse whole seconds only. Comparing the round trip rejects normalized invalid
  // dates (for example February 30 or 24:00), independently of the machine zone.
  const localSeconds = Date.parse(`${match[1]}.000Z`);
  if (!Number.isFinite(localSeconds)
    || new Date(localSeconds).toISOString().slice(0, 19) !== match[1]) return null;
  const offsetHours = match[3] === "Z" ? 0 : Number(match[5]);
  const offsetMinutes = match[3] === "Z" ? 0 : Number(match[6]);
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const offset = (offsetHours * 60 + offsetMinutes) * (match[4] === "-" ? -1 : 1);
  const utc = new Date(localSeconds - offset * 60_000).toISOString();
  if (!/^\d{4}-/.test(utc) || utc.startsWith("0000-")) return null;
  return `${utc.slice(0, 19)}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
