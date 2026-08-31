import type { Metadata } from "next";

import { buildRouteMetadata } from "@/lib/route-metadata";
import { SalesWorkspace } from "./SalesWorkspace";

type SalesSearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  due?: string | string[];
  q?: string | string[];
  stage?: string | string[];
}>;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "Лиды EVO",
    ky: "EVO лиддери",
    en: "EVO leads",
  });
}

export default async function SalesPageContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<SalesSearchParams>;
}>) {
  return <SalesWorkspace searchParams={searchParams} />;
}
