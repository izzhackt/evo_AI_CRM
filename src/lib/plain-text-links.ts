export type PlainTextPart = Readonly<{ text: string; href: string | null }>;

/** Explicit web links only. No HTML/Markdown parsing or remote preview requests. */
export function plainTextLinks(body: string): readonly PlainTextPart[] {
  const parts: PlainTextPart[] = [];
  const links = /https?:\/\/[^\s<>"'`]+/giu;
  let cursor = 0;
  for (const match of body.matchAll(links)) {
    const start = match.index;
    // Do not turn a nested protocol in another token into a misleading anchor.
    if (start > 0 && !/[\s([{]/u.test(body[start - 1])) continue;
    let candidate = match[0].replace(/[.,!?;:]+$/u, "");
    while (candidate.endsWith(")") && (candidate.match(/\)/gu)?.length ?? 0) > (candidate.match(/\(/gu)?.length ?? 0)) candidate = candidate.slice(0, -1);
    candidate = candidate.replace(/[\]}]+$/u, "");
    let href: string;
    try {
      const url = new URL(candidate);
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
      href = url.href;
    } catch { continue; }
    if (start > cursor) parts.push({ text: body.slice(cursor, start), href: null });
    parts.push({ text: candidate, href });
    cursor = start + candidate.length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), href: null });
  return parts;
}
