import { SalesWorkspace } from "./SalesWorkspace";

type SalesSearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  due?: string | string[];
  q?: string | string[];
  stage?: string | string[];
}>;

export default async function SalesPageContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<SalesSearchParams>;
}>) {
  return <SalesWorkspace searchParams={searchParams} />;
}
