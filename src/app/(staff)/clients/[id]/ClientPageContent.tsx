import { notFound } from "next/navigation";

import { StudentWorkspace } from "./StudentWorkspace";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPageContent({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return <StudentWorkspace id={id} searchParams={searchParams} />;
}
