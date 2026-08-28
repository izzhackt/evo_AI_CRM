import { notFound } from "next/navigation";

import { CanonicalStudentCaseWorkspace } from "./CanonicalStudentCaseWorkspace";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ClientPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return <CanonicalStudentCaseWorkspace id={id} />;
}
