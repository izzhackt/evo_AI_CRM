import type { ReactNode } from "react";

import { PortalShell } from "@/components/platform/portal/PortalShell";
import { getPortalPageData } from "@/lib/portal";

export default async function StudentPortalLayout({ children }: { children: ReactNode }) {
  const { user, snapshot, locale } = await getPortalPageData();
  return (
    <PortalShell user={user} snapshot={snapshot} locale={locale}>
      {children}
    </PortalShell>
  );
}
