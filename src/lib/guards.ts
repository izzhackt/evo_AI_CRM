import { redirect } from "next/navigation";
import { currentUser, isStaff, SessionUser } from "./auth";
import { roleCanAccessStaffRoute, StaffRoute } from "./domain";

export async function requireStaffRoute(route: StaffRoute): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.authorityRole)) redirect("/portal");
  if (!roleCanAccessStaffRoute(user.authorityRole, route)) {
    redirect(`/access-denied?from=${encodeURIComponent(route)}`);
  }
  return user;
}

export async function requireAdminPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.authorityRole !== "admin") {
    redirect(
      isStaff(user.authorityRole)
        ? "/access-denied?from=%2Ftranscription-lab"
        : "/portal",
    );
  }
  return user;
}
