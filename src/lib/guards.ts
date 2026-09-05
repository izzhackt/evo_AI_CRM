import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "./auth";

export async function requireAdminPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.authorityRole !== "admin") {
    redirect("/access-denied?from=%2Ftranscription-lab");
  }
  return user;
}
