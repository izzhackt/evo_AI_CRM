import type { CaseOverviewInput } from "../CaseOverview";
import { CaseHandoffCard } from "./CaseHandoffCard";

/**
 * «Передача» в «Обзоре» из прочитанного: читателю «Ждут куратора» и там, где чтение не делалось (другая вкладка), блока
 * нет. Кнопку «Собрать передачу» видит тот, кто может писать шаг дела (`handoffEditable`).
 */
export function CaseHandoff({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const { work } = input;
  const agent = work.agent;
  if (!agent || agent.handoff.kind === "not_read") return null;
  const row = work.row;
  return (
    <CaseHandoffCard
      studentCaseId={input.studentCaseId}
      note={agent.handoff.kind === "ready" ? agent.handoff.note : null}
      unavailable={agent.handoff.kind === "unavailable"}
      editable={input.handoffEditable === true && row !== null}
      direction={row?.admissionsDirection ?? null}
      country={row?.targetCountry ?? null}
      requestId={agent.handoffRequestId}
    />
  );
}
