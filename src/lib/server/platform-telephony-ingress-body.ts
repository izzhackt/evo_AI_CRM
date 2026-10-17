import "server-only";

/**
 * Bounded, flat parsing of a PBX request body BEFORE the `crm_token` is
 * checked (docs/EVO_TELEPHONY_PLAN §5.1, steps 3–4; ADR 0033). The PBX signs
 * nothing, so this is a deliberate exception to «an unsigned body never reaches
 * a parser»: the body is at most 32 KiB, the result is a flat map of strings
 * (no nesting, no repeated key, no `__proto__`, at most 32 fields), nothing
 * touches the database, and no value is logged.
 *
 * The portal documents `application/x-www-form-urlencoded`. JSON, multipart
 * and `text/plain` (a JSON object or a form) are accepted only as insurance
 * until a real call sample is captured (plan §14, step 8).
 */

export const TELEPHONY_MAX_BODY_BYTES = 32 * 1024;
const MAX_FIELDS = 32;
const MAX_KEY_CHARS = 64;
const MAX_VALUE_CHARS = 2048;
const MAX_LINK_CHARS = 1024;

export type TelephonyBodyKind = "form" | "json" | "multipart" | "text";

const MEDIA_KINDS: ReadonlyMap<string, TelephonyBodyKind> = new Map([
  ["application/x-www-form-urlencoded", "form"],
  ["application/json", "json"],
  ["multipart/form-data", "multipart"],
  ["text/plain", "text"],
]);

// The media type alone, without parameters (`;charset=utf-8`, a boundary).
export function telephonyMediaType(contentType: string | null): string {
  if (contentType === null) return "";
  return (contentType.split(";", 1)[0] ?? "").trim().toLowerCase();
}

export function telephonyBodyKind(contentType: string | null): TelephonyBodyKind | null {
  return MEDIA_KINDS.get(telephonyMediaType(contentType)) ?? null;
}

// Safe to write to the application log: the media type only, at most 64
// characters, never a parameter. Anything else is reported as «other».
export function telephonyLogMediaType(contentType: string | null): string {
  const media = telephonyMediaType(contentType);
  if (media === "") return "none";
  return media.length <= 64 && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(media)
    ? media
    : "other";
}

// A coarse size bucket for the application log (plan §5.1, step 4).
export function telephonyBodyBucket(bytes: number | null): string {
  if (bytes === null || bytes > TELEPHONY_MAX_BODY_BYTES) return "gt_32k";
  if (bytes <= 1024) return "le_1k";
  if (bytes <= 4096) return "le_4k";
  return "le_32k";
}

/**
 * Reads the request body with a hard bound: the upload is cancelled as soon as
 * it passes the limit, so an endless or oversized body is never buffered.
 * Resolves null for an oversized body; a transport error rejects.
 */
export async function readBoundedTelephonyBody(
  request: Request,
): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > TELEPHONY_MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function valueLimit(key: string): number {
  return key === "link" ? MAX_LINK_CHARS : MAX_VALUE_CHARS;
}

// One field into the result. False on anything the narrow contract refuses:
// an empty or long key, `__proto__`, a repeated key, a long value, a 33rd field.
function addField(fields: Map<string, string>, key: string, value: string): boolean {
  if (
    key.length < 1 ||
    key.length > MAX_KEY_CHARS ||
    key === "__proto__" ||
    fields.has(key) ||
    fields.size >= MAX_FIELDS ||
    value.length > valueLimit(key)
  ) {
    return false;
  }
  fields.set(key, value);
  return true;
}

function parseForm(text: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(text)) {
    if (!addField(fields, key, value)) return null;
  }
  return fields.size > 0 ? fields : null;
}

const JSON_WHITESPACE = /[ \t\n\r]*/uy;
const JSON_STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/uy;
const JSON_NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
const JSON_LITERAL = /true|false|null/uy;

// One JSON object whose values are strings, numbers, booleans or null. Written
// by hand (not JSON.parse over the whole body) so a repeated key and any nesting
// are refused instead of silently resolved; a string token is unescaped by
// JSON.parse only after its exact shape is matched. `null` carries no value and
// is skipped, but its key still counts as seen.
function parseFlatJson(text: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  const seen = new Set<string>();
  let index = 0;

  const match = (pattern: RegExp): string | null => {
    pattern.lastIndex = index;
    const found = pattern.exec(text);
    if (found === null) return null;
    index = pattern.lastIndex;
    return found[0];
  };
  const skip = () => {
    match(JSON_WHITESPACE);
  };
  const expect = (char: string): boolean => {
    if (text[index] !== char) return false;
    index += 1;
    return true;
  };

  skip();
  if (!expect("{")) return null;
  skip();
  if (text[index] === "}") return null; // an empty object carries no fields
  for (;;) {
    skip();
    const keyToken = match(JSON_STRING);
    if (keyToken === null) return null;
    const key = JSON.parse(keyToken) as string;
    skip();
    if (!expect(":")) return null;
    skip();

    let value: string | null;
    const stringToken = match(JSON_STRING);
    if (stringToken !== null) {
      value = JSON.parse(stringToken) as string;
    } else {
      const numberToken = match(JSON_NUMBER);
      if (numberToken !== null) {
        value = numberToken;
      } else {
        const literal = match(JSON_LITERAL);
        if (literal === null) return null;
        value = literal === "null" ? null : literal;
      }
    }

    if (seen.has(key) || seen.size >= MAX_FIELDS) return null;
    seen.add(key);
    if (value !== null && !addField(fields, key, value)) return null;

    skip();
    if (expect(",")) continue;
    if (!expect("}")) return null;
    break;
  }
  skip();
  return index === text.length && fields.size > 0 ? fields : null;
}

async function parseMultipart(
  body: Uint8Array,
  contentType: string,
): Promise<Map<string, string> | null> {
  // A copy typed as an ArrayBuffer-backed view (at most 32 KiB).
  const form = await new Response(new Uint8Array(body), {
    headers: { "content-type": contentType },
  }).formData();
  const fields = new Map<string, string>();
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" || !addField(fields, key, value)) return null;
  }
  return fields.size > 0 ? fields : null;
}

/**
 * The body as a flat map of strings, or null when it cannot be parsed within
 * the contract (the caller answers 400).
 */
export async function parseTelephonyBody(
  kind: TelephonyBodyKind,
  body: Uint8Array,
  contentType: string,
): Promise<Map<string, string> | null> {
  if (body.byteLength === 0) return null;
  try {
    if (kind === "multipart") return await parseMultipart(body, contentType);
    const text = new TextDecoder("utf-8").decode(body);
    if (kind === "form") return parseForm(text);
    if (kind === "json") return parseFlatJson(text);
    // text/plain: a JSON object when it starts like one, otherwise a form.
    return text.trimStart().startsWith("{") ? parseFlatJson(text) : parseForm(text);
  } catch {
    return null;
  }
}
