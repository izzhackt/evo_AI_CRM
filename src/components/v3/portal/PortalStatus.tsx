import { Pill, type PillTone } from "@/components/v3/Pill";

export function PortalStatus({
  label,
  tone = "neutral",
}: {
  label: string | null;
  tone?: PillTone;
}) {
  return <Pill tone={tone}>{label ?? "статус недоступен"}</Pill>;
}
