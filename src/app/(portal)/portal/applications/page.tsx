import { redirect } from "next/navigation";

// Unified workflow (S5): «Заявки и виза» is retired (plan §13 — the platform
// no longer tracks university-application/visa stages as their own screen).
// This route stays connected (platform-route-contract.ts) only so old
// bookmarks and notification links still resolve, instead of a hidden 404
// before the portal shell ever mounts; it performs no read of its own. Visa
// files remain ordinary documents in «Документы» (a document requirement,
// unrelated to this retired screen).
export default function StudentPortalApplicationsRedirect() {
  redirect("/portal");
}
