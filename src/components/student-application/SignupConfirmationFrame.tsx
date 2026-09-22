import type { ReactNode } from "react";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";

/** No navigation/locale reload that could discard an email link held only in memory. */
export function SignupConfirmationFrame({ children }: { children: ReactNode }) {
  return <main className="min-h-dvh bg-bg text-fg">
    <header className="mx-auto flex max-w-6xl px-5 py-6 sm:px-8">
      <span className="rounded-ctl bg-white p-2"><EvoLogo width={146} /></span>
    </header>
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-3 sm:px-8 sm:pt-8">{children}</div>
  </main>;
}
