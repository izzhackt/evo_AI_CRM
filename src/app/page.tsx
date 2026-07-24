import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ROLE_HOME_ROUTE } from "@/lib/domain";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(ROLE_HOME_ROUTE[user.role]);
}
