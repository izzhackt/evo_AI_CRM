import { redirect } from "next/navigation";
import { currentUser, isStaff } from "@/lib/auth";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(isStaff(user.role) ? "/dashboard" : "/portal");
}
