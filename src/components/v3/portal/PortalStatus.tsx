import { Pill } from "@/components/v3/Pill";
import type { PortalStatus as PortalStatusValue } from "@/components/v3/portal/types";

export function PortalStatus({ status }: { status: PortalStatusValue }) {
  return <Pill tone={status.tone}>{status.label}</Pill>;
}
