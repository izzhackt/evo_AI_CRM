import { NextRequest } from "next/server";

export async function readJsonObject(req: NextRequest, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
