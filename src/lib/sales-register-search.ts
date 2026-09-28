/** Empty means no search; null means invalid input. Bound the original input. */
export function parseSalesRegisterSearchQuery(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 400 || [...value].length > 200
    || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim();
}
