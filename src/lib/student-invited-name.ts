/**
 * PORT-1b: prefill only what the invited person already sees as their own —
 * the receipt's display name (their invite was addressed with it). Lead-side
 * contact facts are staff data and are deliberately not copied here.
 *
 * One function for both consumers: the /apply page (server component) and the
 * app's link check (POST /api/portal/registration/link-check). It was a private
 * function of the page, copied into the route handler; sharing it removes the
 * copy. Pure and client-safe: no server-only imports.
 */
export type InvitedNamePrefill = Readonly<{ firstName: string; lastName: string }>;

/** First word is the first name, the rest the last name, each up to 60 characters; no name, no prefill. */
export function invitedNamePrefill(displayName: string | null | undefined): InvitedNamePrefill | null {
  const [first = "", ...rest] = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (first.length === 0) return null;
  return {
    firstName: first.slice(0, 60),
    lastName: rest.join(" ").slice(0, 60),
  };
}
