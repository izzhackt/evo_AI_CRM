import { redirect } from "next/navigation";
import { currentUser, isStaff, SessionUser } from "./auth";
import { roleCanAccessStaffRoute, StaffRoute } from "./domain";

export async function requireStaffRoute(route: StaffRoute): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/portal");
  if (!roleCanAccessStaffRoute(user.role, route)) {
    redirect(`/access-denied?from=${encodeURIComponent(route)}`);
  }
  return user;
}

export async function requireAdminPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    redirect(isStaff(user.role) ? "/access-denied?from=%2Ftranscription-lab" : "/portal");
  }
  return user;
}
