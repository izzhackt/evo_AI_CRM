import { notFound } from "next/navigation";

import { SalesLeadWorkspace } from "./SalesLeadWorkspace";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return <SalesLeadWorkspace id={id} />;
}
