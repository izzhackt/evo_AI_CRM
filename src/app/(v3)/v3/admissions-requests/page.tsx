import { redirect } from "next/navigation";

// Unified workflow (S1): «Заявки» moved from Admissions to Продажи, gated by
// sales.read instead of admissions.read — see /v3/requests. This route stays
// connected (platform-route-contract.ts) only so old bookmarks/links still
// resolve; it performs no read or auth check of its own. The destination page
// enforces its own actor/capability gate.
export default function AdmissionsRequestsRedirect() {
  redirect("/v3/requests");
}
