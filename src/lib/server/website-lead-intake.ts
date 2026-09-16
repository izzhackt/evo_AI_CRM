import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const MAX_BYTES = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGINS = new Set(["https://evoadmissions.com", "https://www.evoadmissions.com"]);
const FIELDS = ["requestId", "name", "phone", "age", "city", "country", "consent", "website"];
const COUNTRIES = new Set(["China", "Malaysia", "Europe", "Germany", "United Kingdom", "Italy",
  "Netherlands", "France", "Poland", "United Arab Emirates", "Turkey"]);

function response(status: number, code: string, requestId?: string): Response {
  return Response.json(requestId ? { status: code, requestId } : { error: code }, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      ...(status === 429 ? { "Retry-After": "600" } : {}) },
  });
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
}

async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error("size");
  if (!request.body) throw new Error("json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = Date.now() + 5000;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), Math.max(1, deadline - Date.now()));
      })]).finally(() => clearTimeout(timer));
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error("size"); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function receiveWebsiteLead(request: Request): Promise<Response> {
  const key = process.env.EVO_WEBSITE_INTAKE_EDGE_KEY;
  const organizationId = process.env.EVO_PLATFORM_ORGANIZATION_ID;
  const ownerId = process.env.EVO_WEBSITE_INTAKE_OWNER_MEMBERSHIP_ID;
  if (!key || !/^[A-Za-z0-9_-]{43,128}$/.test(key) || !organizationId || !CONFIG_UUID.test(organizationId)
    || !ownerId || !CONFIG_UUID.test(ownerId)) return response(503, "unavailable");
  const suppliedKey = request.headers.get("x-evo-website-key") ?? "";
  if (Buffer.byteLength(suppliedKey) !== Buffer.byteLength(key)
    || !timingSafeEqual(Buffer.from(suppliedKey), Buffer.from(key))
    || !ORIGINS.has(request.headers.get("origin") ?? "")) return response(403, "forbidden");
  const ip = request.headers.get("x-evo-website-ip") ?? "";
  if (!isIP(ip)) return response(403, "forbidden");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    || (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity")) {
    return response(415, "unsupported_media_type");
  }
  let body: unknown;
  try { body = await readBody(request); }
  catch (error) { return response(error instanceof Error && error.message === "size" ? 413 : 400,
    error instanceof Error && error.message === "size" ? "request_too_large" : "invalid_request"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, "invalid_request");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== FIELDS.length || Object.keys(input).some(key => !FIELDS.includes(key))
    || typeof input.requestId !== "string" || !UUID.test(input.requestId)
    || !text(input.name, 300) || !text(input.phone, 50) || !/^\+?[\d\s().-]{7,40}$/.test(input.phone)
    || (input.age !== null && (typeof input.age !== "number" || !Number.isInteger(input.age) || input.age < 10 || input.age > 100))
    || (input.city !== null && !text(input.city, 150)) || !text(input.country, 100) || !COUNTRIES.has(input.country)
    || input.consent !== true || input.website !== "") return response(400, "invalid_request");
  const phone = input.phone.replace(/[\s().-]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) return response(400, "invalid_request");
  try {
    const client = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    const { data, error } = await client.schema("platform").rpc("receive_website_lead", {
      p_organization_id: organizationId, p_owner_membership_id: ownerId, p_request_id: input.requestId,
      p_name: input.name.trim(), p_phone: phone, p_age: input.age,
      p_city: typeof input.city === "string" ? input.city.trim() : null, p_country: input.country.trim(),
      p_consent: true, p_ip_hash: createHmac("sha256", key).update(ip).digest("hex"),
    }).abortSignal(AbortSignal.timeout(10000));
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return response(503, "unavailable");
    if (data.status === "accepted" && data.request_id === input.requestId.toLowerCase()) return response(200, "accepted", input.requestId);
    if (data.status === "rate_limited") return response(429, "rate_limited");
    if (data.status === "request_conflict") return response(409, "request_conflict");
    return response(503, "unavailable");
  } catch { return response(503, "unavailable"); }
}
