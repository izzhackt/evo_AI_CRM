import type { ReactNode } from "react";

import { requirePlatformDocumentsActor } from "@/lib/platform-guards";

export default async function DocumentsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requirePlatformDocumentsActor();
  return children;
}
