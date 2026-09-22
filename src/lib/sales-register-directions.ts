import { parseSalesUuid } from "./platform-sales-register-contract.ts";

/** Empty selects every direction; null is invalid. Never normalize a stored label. */
export function parseSalesRegisterDirection(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 1000 || [...value].length > 500
    || /[\u0000-\u001f\u007f]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) return null;
  return value;
}

/** Separate DTO: the existing report's strict v1/v2 contracts remain unchanged. */
export function parseSalesRegisterDirections(raw: unknown, organizationId: string): readonly string[] {
  const unavailable = () => new Error("Sales directions are unavailable.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw unavailable();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "organization_id")
    || !Object.hasOwn(value, "directions") || value.organization_id !== organizationId
    || parseSalesUuid(organizationId) !== organizationId || !Array.isArray(value.directions)
    || value.directions.length > 1000) throw unavailable();
  const labels = new Set<string>();
  for (const direction of value.directions) {
    if (typeof direction !== "string" || direction === ""
      || parseSalesRegisterDirection(direction) !== direction || labels.has(direction)) throw unavailable();
    labels.add(direction);
  }
  return [...labels];
}

export type SalesDirectionControl =
  | Readonly<{ kind: "input"; value: string; reason: "invalid" | "unavailable" }>
  | Readonly<{ kind: "select"; value: string; empty: boolean; options: readonly Readonly<{ value: string; label: string }>[] }>;

export function salesDirectionControl(directions: readonly string[] | null, current: unknown): SalesDirectionControl {
  const value = parseSalesRegisterDirection(current);
  if (value === null) return { kind: "input", value: typeof current === "string" ? current : "", reason: "invalid" };
  if (directions === null) return { kind: "input", value, reason: "unavailable" };
  const options = [{ value: "", label: "Все" }];
  if (value !== "" && !directions.includes(value)) options.push({ value, label: `Из текущего фильтра: ${value}` });
  options.push(...directions.map(direction => ({ value: direction, label: direction })));
  return { kind: "select", value, empty: directions.length === 0, options };
}
