import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";
import {
  changePlatformStaffPermissionAction,
  changePlatformStaffRoleAction,
  changePlatformStaffStatusAction,
  provisionPlatformStaffMemberAction,
  type StaffActionOutcome,
} from "@/lib/platform-staff-actions";
import {
  PLATFORM_MEMBERSHIP_STATUSES,
  PLATFORM_STAFF_ROLES,
  listPlatformStaffMembers,
  requirePlatformStaffAdminActor,
  type PlatformStaffMember,
} from "@/lib/platform-staff-directory";

type SettingsSearchParams = Record<string, string | string[] | undefined>;

const OUTCOME_MESSAGES: Record<StaffActionOutcome, string> = {
  provisioned: "Сотрудник добавлен; событие записано в аудит.",
  role_changed: "Роль изменена; прежний токен отозван.",
  status_changed: "Статус изменён; прежний токен отозван.",
  permission_changed: "Чувствительное разрешение изменено и записано в аудит.",
  invalid_user: "Идентификатор или имя сотрудника указаны неверно.",
  invalid_role: "Разрешены только три роли пилота.",
  invalid_status: "Статус не входит в утверждённый жизненный цикл.",
  invalid_permission: "Неизвестное чувствительное разрешение.",
  invalid_reason: "Укажите причину от 3 до 500 символов для аудита.",
  admin_not_confirmed: "Выдача роли Admin требует отдельного подтверждения.",
  rejected: "База данных отклонила действие; ничего не изменено.",
  unavailable: "Служба доступа недоступна; ничего не изменено.",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Director/Admin",
  sales: "Sales Manager",
  curator: "Admissions Manager",
};

const STATUS_LABELS: Record<string, string> = {
  invited: "Приглашён",
  active: "Активен",
  suspended: "Приостановлен",
  inactive: "Неактивен",
  blocked: "Заблокирован",
};

function readOutcome(params: SettingsSearchParams): StaffActionOutcome | null {
  const value = params.staff_result;
  return typeof value === "string" && value in OUTCOME_MESSAGES
    ? (value as StaffActionOutcome)
    : null;
}

function PermissionForm({
  member,
  permissionKey,
  label,
  granted,
}: {
  member: PlatformStaffMember;
  permissionKey:
    | "contract.evidence.confirm"
    | "finance.first.payment.confirm";
  label: string;
  granted: boolean;
}) {
  return (
    <form
      action={changePlatformStaffPermissionAction}
      className="grid gap-2 rounded-lg border border-border p-3"
      data-testid={`platform-staff-permission-${permissionKey}`}
    >
      <input name="membership_id" type="hidden" value={member.membershipId} />
      <input name="permission_key" type="hidden" value={permissionKey} />
      <input name="granted" type="hidden" value={granted ? "false" : "true"} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-fg">{label}</span>
        <Badge
          value={granted ? "granted" : "denied"}
          label={granted ? "выдано лично" : "не выдано"}
        />
      </div>
      <input
        aria-label={`Причина изменения: ${label}`}
        className={inputCls}
        name="reason"
        placeholder="Причина для неизменяемого аудита"
        required
      />
      <button className={cn(btnGhostCls, "justify-self-start")} type="submit">
        {granted ? "Отозвать" : "Выдать"}
      </button>
    </form>
  );
}

function MemberRow({ member }: { member: PlatformStaffMember }) {
  return (
    <li
      className="grid gap-4 border-t border-border py-5"
      data-membership-id={member.membershipId}
      data-testid="platform-staff-row"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-fg">
          {member.displayName}
        </span>
        <Badge value={member.role} label={ROLE_LABELS[member.role]} />
        <Badge value={member.status} label={STATUS_LABELS[member.status]} />
        {member.isActingAdmin ? <Badge value="self" label="это вы" /> : null}
        <span className="text-[11px] text-muted">
          access v{member.accessVersion}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <form action={changePlatformStaffRoleAction} className="grid gap-2">
          <input name="membership_id" type="hidden" value={member.membershipId} />
          <label className={labelCls}>Роль пилота</label>
          <select className={inputCls} defaultValue={member.role} name="role">
            {PLATFORM_STAFF_ROLES.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
          <input className={inputCls} name="reason" placeholder="Причина смены роли" required />
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input name="confirm_admin" type="checkbox" value="yes" />
            Подтверждаю назначение Director/Admin
          </label>
          <button className={cn(btnGhostCls, "justify-self-start")} type="submit">
            Изменить роль
          </button>
        </form>

        <form action={changePlatformStaffStatusAction} className="grid gap-2">
          <input name="membership_id" type="hidden" value={member.membershipId} />
          <label className={labelCls}>Статус доступа</label>
          <select className={inputCls} defaultValue={member.status} name="status">
            {PLATFORM_MEMBERSHIP_STATUSES.map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
          <input className={inputCls} name="reason" placeholder="Причина смены статуса" required />
          <button className={cn(btnGhostCls, "justify-self-start")} type="submit">
            Изменить статус
          </button>
        </form>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <PermissionForm
          granted={member.contractConfirmationGranted}
          label="Подтверждение договора"
          member={member}
          permissionKey="contract.evidence.confirm"
        />
        <PermissionForm
          granted={member.firstPaymentConfirmationGranted}
          label="Подтверждение первого платежа"
          member={member}
          permissionKey="finance.first.payment.confirm"
        />
      </div>
    </li>
  );
}

export default async function PlatformStaffSettingsPage({
  searchParams,
}: {
  searchParams: SettingsSearchParams;
}) {
  const actor = await requirePlatformStaffAdminActor();
  const members = await listPlatformStaffMembers(actor);
  const outcome = readOutcome(searchParams);

  return (
    <div className="grid gap-5" data-testid="platform-staff-settings">
      <PageHeader
        title="Доступ сотрудников"
        description="Один Supabase-вход, три роли пилота и личные чувствительные разрешения. Каждое изменение проверяет живая база и попадает в аудит."
      />
      {outcome ? (
        <Card data-testid="platform-staff-outcome">
          <p className="text-[13px] text-fg">{OUTCOME_MESSAGES[outcome]}</p>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 text-[15px] font-bold text-fg">Добавить сотрудника</h2>
        <p className="mb-4 text-[12px] leading-5 text-muted">
          Сначала создайте пользователя в Supabase Auth, затем свяжите его UUID
          с одной персональной записью EVO. Пароль здесь не хранится.
        </p>
        <form action={provisionPlatformStaffMemberAction} className="grid gap-3 lg:grid-cols-2">
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="staff-auth-user-id">UUID пользователя Auth</label>
            <input className={inputCls} id="staff-auth-user-id" name="auth_user_id" required />
          </div>
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="staff-display-name">Имя сотрудника</label>
            <input className={inputCls} id="staff-display-name" name="display_name" required />
          </div>
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="staff-role">Роль пилота</label>
            <select className={inputCls} defaultValue="sales" id="staff-role" name="role">
              {PLATFORM_STAFF_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="staff-reason">Причина</label>
            <input className={inputCls} id="staff-reason" name="reason" required />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted lg:col-span-2">
            <input name="confirm_admin" type="checkbox" value="yes" />
            Подтверждаю назначение Director/Admin, если выбрана эта роль
          </label>
          <button className={cn(btnCls, "justify-self-start")} type="submit">Добавить</button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 text-[15px] font-bold text-fg">Текущий состав пилота</h2>
        {members === null ? (
          <EmptyState text="Каталог сотрудников недоступен. Ничего не изменено." />
        ) : members.length === 0 ? (
          <EmptyState text="В организации нет участников пилота." />
        ) : (
          <ul className="grid">
            {members.map((member) => <MemberRow key={member.membershipId} member={member} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
