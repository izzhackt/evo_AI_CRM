import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buildRouteMetadata } from "@/lib/route-metadata";
import { SalesLeadWorkspace } from "./SalesLeadWorkspace";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "Lead 360",
    ky: "Lead 360",
    en: "Lead 360",
  });
}

export default async function LeadPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return <SalesLeadWorkspace id={id} />;
}
