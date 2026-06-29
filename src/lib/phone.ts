export function normalizePhone(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00") && digits.length > 2) return `+${digits.slice(2)}`;
  if (digits.startsWith("996")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+996${digits.slice(1)}`;
  if (digits.length === 9) return `+996${digits}`;
  return `+${digits}`;
}
