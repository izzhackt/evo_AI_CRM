import type { Metadata } from "next";

import { buildRouteMetadata } from "@/lib/route-metadata";
import { StudentQueue } from "./StudentQueue";

type SearchParams = Readonly<{
  stage?: string;
  q?: string;
  lifecycle?: string;
  before_at?: string | string[];
  before_id?: string | string[];
}>;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "Student 360",
    ky: "Student 360",
    en: "Student 360",
  });
}

export default async function ClientsPageContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) {
  return <StudentQueue searchParams={searchParams} />;
}
