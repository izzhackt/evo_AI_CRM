import type { Metadata } from "next";
import { StaffAccountAccess } from "@/components/StaffAccountAccess";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { resolvePlatformActor } from "@/lib/platform-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Вход сотрудника | EVO Admissions",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function StaffAccountPage() {
  const result = await resolvePlatformActor();
  const initial = result.status === "authenticated" && ["admin", "sales", "admissions"].includes(result.actor.authorityRole)
    ? { ready: true, email: result.actor.email, error: "" } : undefined;
  return <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
    <section aria-labelledby="staff-account-title" className="w-full max-w-[440px] rounded-[20px] bg-surface p-6 shadow-evo-lg">
      <div className="mb-5 flex items-center gap-3"><EvoMark size={38} /><span className="font-semibold">EVO Admissions</span></div>
      <h1 id="staff-account-title" className="text-2xl font-bold leading-tight">Вход сотрудника</h1>
      <StaffAccountAccess initial={initial} />
    </section>
  </main>;
}
