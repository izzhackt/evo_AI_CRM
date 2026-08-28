import { SalesWorkspace } from "./SalesWorkspace";

type SalesSearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  intake_before_at?: string | string[];
  intake_before_id?: string | string[];
  intake_q?: string | string[];
  intake_state?: string | string[];
  lifecycle?: string;
  q?: string;
  stage?: string;
  manager?: string;
  source?: string;
  risk?: string;
  status?: string;
  view?: string;
}>;

export default async function SalesPageContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<SalesSearchParams>;
}>) {
  return <SalesWorkspace searchParams={searchParams} />;
}
