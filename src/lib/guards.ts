import { redirect } from "next/navigation";
import { currentUser, isStaff, SessionUser } from "./auth";
import { ROLE_HOME_ROUTE, roleCanAccessStaffRoute, StaffRoute } from "./domain";

export async function requireStaffRoute(route: StaffRoute): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/portal");
  if (!roleCanAccessStaffRoute(user.role, route)) {
    redirect(ROLE_HOME_ROUTE[user.role]);
  }
  return user;
}

export async function requireAdminPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    redirect(isStaff(user.role) ? ROLE_HOME_ROUTE[user.role] : "/portal");
  }
  return user;
}
