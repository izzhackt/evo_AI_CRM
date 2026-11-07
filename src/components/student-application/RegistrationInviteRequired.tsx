import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import type { RegistrationLinkCheck } from "@/lib/server/student-registration-link";

import { SignupConfirmationFrame } from "./SignupConfirmationFrame";

/**
 * 341 (07.11.2026): новый аккаунт — только по личной ссылке менеджера. Без ссылки или с негодной ссылкой анкета
 * не открывается; экран говорит, что случилось, и ведёт ко входу тех, у кого аккаунт уже есть.
 */
export function RegistrationInviteRequired({ status, locale }: Readonly<{ status: Exclude<RegistrationLinkCheck["status"], "valid">; locale: Locale }>) {
  const strings = getPortalStrings("apply", locale);
  const text = status === "used" ? strings["invite.used"]
    : status === "expired" ? strings["invite.expired"]
      : status === "unavailable" ? strings["invite.unavailable"] : strings["invite.text"];
  return (
    <SignupConfirmationFrame>
      <section aria-labelledby="registration-invite-title" className="rounded-card border border-border bg-surface px-5 py-6 sm:px-10" data-testid="registration-invite-required">
        <h1 id="registration-invite-title" className="mb-3 text-2xl font-semibold text-fg">{strings["invite.title"]}</h1>
        <p role={status === "unavailable" ? "alert" : undefined} className="mb-4 text-fg-2">{text}</p>
        <Link href="/login" className="inline-flex min-h-11 items-center text-accent-text underline">{strings["invite.login"]}</Link>
      </section>
    </SignupConfirmationFrame>
  );
}
