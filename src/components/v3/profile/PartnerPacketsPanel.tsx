import { Icon } from "@/components/icons";
import type { PacketWorkspace } from "@/lib/platform-admissions-support-contract";
import { PartnerPacketWorkspace } from "./CaseOperationsForms";
import { partnerPacketExport as words } from "@/lib/v3/wording";

/**
 * Пакеты документов партнёру — раскрытие под списком вузов. Чтение пакетов
 * делает вкладка (`UniversityProgramsTab`), здесь только разметка: `null` —
 * пакеты не прочитаны. «⋯ → Пакет партнёру» строки вуза открывает панель
 * адресом `panel=packets&packet_application=…#partner-packets` — заявка уже
 * выбрана в форме (`initialApplicationId`). `<details id="partner-packets">`
 * с `summary` первым ребёнком — адрес проверки пакетов в браузере.
 */
export function PartnerPacketsPanel({ caseId, active, applications, workspace, initiallyOpen = false, initialApplicationId = null }: {
  caseId: string;
  active: boolean;
  applications: readonly { id: string; name: string }[];
  workspace: PacketWorkspace | null;
  initiallyOpen?: boolean;
  initialApplicationId?: string | null;
}) {
  return <details className="group scroll-mt-4 border-b border-border" id="partner-packets" open={initiallyOpen}>
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-nav py-1.5 [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 flex-1 t-item text-fg">{words.title}</span>
      <Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="pb-4 pt-1">
      {!workspace ? <p role="alert" className="text-sm text-danger">{words.unavailable}</p>
        : <PartnerPacketWorkspace key={caseId} caseId={caseId} active={active} applications={applications} workspace={workspace} initialApplicationId={initialApplicationId} />}
    </div>
  </details>;
}
