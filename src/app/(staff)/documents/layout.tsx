import type { ReactNode } from "react";

import { requireStaffRoute } from "@/lib/guards";

export default async function DocumentsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStaffRoute("/documents");
  return children;
}
