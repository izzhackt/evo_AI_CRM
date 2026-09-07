import type { ReactNode } from "react";

import { PortalShell } from "@/components/v3/portal/PortalShell";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

import "../(v3)/v3.css";

export default async function StudentPortalLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const actor = await requireStudentPortalActor();

  return <PortalShell displayName={actor.displayName}>{children}</PortalShell>;
}
