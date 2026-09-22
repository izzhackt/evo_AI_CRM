export const WEBSITE_ENQUIRY_COUNTRIES = new Set([
  "China", "Malaysia", "Europe", "Germany", "United Kingdom", "Italy",
  "Netherlands", "France", "Poland", "United Arab Emirates", "Turkey", "Undecided",
]);

export type WebsiteEnquiryUniversity = Readonly<{ slug: string; name: string }>;

/** Visitor-supplied context, not an authoritative CRM university association. */
export function parseWebsiteEnquiryUniversity(value: unknown): WebsiteEnquiryUniversity | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid website university.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "slug") || !Object.hasOwn(input, "name")
    || typeof input.slug !== "string" || input.slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
    || typeof input.name !== "string" || input.name.length > 300 || input.name.trim().length === 0
    || /[\u0000-\u001f\u007f]/.test(input.name)) throw new Error("Invalid website university.");
  return { slug: input.slug, name: input.name.trim() };
}
