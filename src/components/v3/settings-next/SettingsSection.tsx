import { DeletionNext } from "./DeletionNext";
import { DepartmentsNext } from "./DepartmentsNext";
import { DocumentsNext } from "./DocumentsNext";
import { IntegrationsNext } from "./IntegrationsNext";
import { JournalNext } from "./JournalNext";
import { PlatformNext } from "./PlatformNext";
import { ReportsNext } from "./ReportsNext";
import { RolesNext } from "./RolesNext";
import { StaffNext } from "./StaffNext";
import { StaffUnavailable } from "./StaffUnavailable";
import { TelephonyNext } from "./TelephonyNext";
import type { SettingsNextProps } from "./settings-next-types";

/** Раздел «Настроек» по адресу `?section=`: одна ветка на раздел, данные раздела страница прислала заранее. */
function SectionBody(props: SettingsNextProps) {
  const { section, staffView } = props;
  if (section === "staff") {
    if (!props.staff) return <StaffUnavailable view={staffView} />;
    const { data, roles, organizationId, selectedMemberId, selectedRoleId } = props.staff;
    if (!data.available) return <StaffUnavailable view={staffView} />;
    if (staffView === "roles") return <RolesNext workspace={roles} selectedRoleId={selectedRoleId} />;
    if (staffView === "departments") return <DepartmentsNext departments={data.departments} />;
    return <StaffNext data={data} roles={roles} organizationId={organizationId} selectedMemberId={selectedMemberId} />;
  }
  if (section === "integrations") return <IntegrationsNext rows={props.integrations} whatsapp={props.whatsapp} nowIso={props.nowIso} />;
  if (section === "telephony" && props.telephony) return <TelephonyNext {...props.telephony} nowIso={props.nowIso} />;
  if (section === "reports" && props.reports) return <ReportsNext {...props.reports} />;
  if (section === "journal" && props.journal) return <JournalNext {...props.journal} />;
  if (section === "deletion" && props.deletion) return <DeletionNext {...props.deletion} nowIso={props.nowIso} />;
  if (section === "documents" && props.gates) return <DocumentsNext gates={props.gates} />;
  if (section === "platform" && props.platform) return <PlatformNext {...props.platform} />;
  return null;
}

/** Раздел под скрытым заголовком второго уровня: заголовки карточек раздела идут под ним, ряд разделов их не заменяет. */
export function SettingsSection(props: SettingsNextProps) {
  const current = props.nav.find((item) => item.current);
  return (
    <div className="grid min-w-0 gap-4">
      <h2 className="sr-only">{current?.title}</h2>
      <SectionBody {...props} />
    </div>
  );
}
