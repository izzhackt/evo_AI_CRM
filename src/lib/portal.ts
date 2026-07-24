import { cache } from "react";
import { redirect } from "next/navigation";

import { currentUser } from "./auth";
import { getT } from "./i18n";
import { studentPortalSnapshotForUser } from "./queries";

/**
 * Resolves the authenticated student and only that student's portal snapshot.
 *
 * The user id always comes from the signed HTTP-only session cookie. Portal
 * routes never accept a client id from params or search input, which keeps a
 * student from selecting another student's record.
 */
export const getPortalPageData = cache(async () => {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "client") redirect("/dashboard");

  const { t, locale } = await getT();
  return {
    user,
    snapshot: studentPortalSnapshotForUser(user.id),
    t,
    locale,
  };
});
