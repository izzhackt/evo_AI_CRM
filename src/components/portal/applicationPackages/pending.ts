"use client";
import { useMemo, useSyncExternalStore } from "react";
import { APPLICATION_PACKAGE_PENDING_EVENT, listApplicationPackagePending, type ApplicationPackageScope } from "@/lib/portal/application-packages-pending";
export function subscribePackagePending(callback: () => void) {
  window.addEventListener(APPLICATION_PACKAGE_PENDING_EVENT, callback); window.addEventListener("storage", callback);
  return () => { window.removeEventListener(APPLICATION_PACKAGE_PENDING_EVENT, callback); window.removeEventListener("storage", callback); };
}
export function usePackagePending(scope: ApplicationPackageScope) {
  const snapshot = useSyncExternalStore(subscribePackagePending, () => {
    try { return JSON.stringify(listApplicationPackagePending(scope)); } catch { return "blocked"; }
  }, () => "hydrating");
  return useMemo(() => ({ hydrated: snapshot !== "hydrating", blocked: snapshot === "blocked", entries:
    snapshot === "blocked" || snapshot === "hydrating" ? [] : JSON.parse(snapshot) as ReturnType<typeof listApplicationPackagePending> }), [snapshot]);
}

export const packageScopeKey = (scope: ApplicationPackageScope) => [scope.organizationId, scope.membershipId, scope.studentCaseId, scope.applicationId].join(":");
