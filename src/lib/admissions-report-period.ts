export function admissionsReportPeriod(month: string | undefined, now = new Date()): { month: string; from: string; to: string } | null {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Bishkek" }).formatToParts(now);
  const selected = month ?? `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
  if (!/^(19[7-9]\d|20\d\d|2100)-(0[1-9]|1[0-2])$/.test(selected)) return null;
  const [year, number] = selected.split("-").map(Number);
  return { month: selected, from: `${selected}-01`, to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}
