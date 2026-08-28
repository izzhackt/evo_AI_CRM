import { StudentQueue } from "./StudentQueue";

type SearchParams = Readonly<{
  stage?: string;
  q?: string;
  lifecycle?: string;
  before_at?: string | string[];
  before_id?: string | string[];
}>;

export default async function ClientsPageContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) {
  return <StudentQueue searchParams={searchParams} />;
}
