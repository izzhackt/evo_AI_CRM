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
  provisioned: "Сотрудник добавлен. Действие записано в аудит.",
  role_changed: "Роль изменена. Действие записано в аудит.",
  status_changed: "Статус изменён. Действие записано в аудит.",
  invalid_user: "Идентификатор или имя указаны неверно.",
  invalid_role: "Такой роли не существует.",
  invalid_status: "Такого статуса не существует.",
  invalid_reason: "Причина обязательна: она попадает в неизменяемый аудит.",
  admin_not_confirmed:
    "Выдача роли администратора требует явного подтверждения.",
  rejected:
    "Действие отклонено. Возможные причины: учётной записи не существует, недостаточно прав, либо это последний администратор организации.",
  unavailable: "Служба недоступна. Ничего не изменено.",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  sales: "Продажи",
  curator: "Куратор",
  finance: "Финансы",
  student: "Студент",
};

const STATUS_LABELS: Record<string, string> = {
  invited: "Приглашён",
  active: "Активен",
  inactive: "Неактивен",
  blocked: "Заблокирован",
};

function readOutcome(params: SettingsSearchParams): StaffActionOutcome | null {
  const value = params.staff_result;
  if (typeof value !== "string") return null;
  return value in OUTCOME_MESSAGES ? (value as StaffActionOutcome) : null;
}

function MemberRow({ member }: { member: PlatformStaffMember }) {
  return (
    <li className="flex flex-col gap-3 border-t border-border py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-fg">
          {member.displayName}
        </span>
        <Badge
          value={member.role}
          label={ROLE_LABELS[member.role] ?? member.role}
        />
        <Badge
          value={member.status}
          label={STATUS_LABELS[member.status] ?? member.status}
        />
        {member.isActingAdmin ? <Badge value="self" label="это вы" /> : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <form action={changePlatformStaffRoleAction} className="grid gap-2">
          <input type="hidden" name="membership_id" value={member.membershipId} />
          <label className={labelCls} htmlFor={`role-${member.membershipId}`}>
            Изменить роль
          </label>
          <select
            className={inputCls}
            id={`role-${member.membershipId}`}
            name="role"
            defaultValue={member.role === "student" ? "sales" : member.role}
          >
            {PLATFORM_STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input name="confirm_admin" type="checkbox" value="yes" />
            Подтверждаю выдачу роли администратора
          </label>
          <input
            className={inputCls}
            name="reason"
            placeholder="Причина изменения"
            required
          />
          <button className={cn(btnGhostCls, "justify-self-start")} type="submit">
            Изменить роль
          </button>
        </form>

        <form action={changePlatformStaffStatusAction} className="grid gap-2">
          <input type="hidden" name="membership_id" value={member.membershipId} />
          <label className={labelCls} htmlFor={`status-${member.membershipId}`}>
            Изменить статус
          </label>
          <select
            className={inputCls}
            id={`status-${member.membershipId}`}
            name="status"
            defaultValue={member.status}
          >
            {PLATFORM_MEMBERSHIP_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            name="reason"
            placeholder="Причина изменения"
            required
          />
          <button className={cn(btnGhostCls, "justify-self-start")} type="submit">
            Изменить статус
          </button>
        </form>
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
    <div className="grid gap-5">
      <PageHeader
        title="Сотрудники"
        description="Доступ выдаёт только администратор. У каждого сотрудника личная учётная запись; общий доступ запрещён."
      />

      {outcome ? (
        <Card>
          <p className="text-[14px] text-fg">{OUTCOME_MESSAGES[outcome]}</p>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-1 text-[15px] font-bold text-fg">Добавить сотрудника</h2>
        <p className="mb-3 text-[13px] text-muted">
          Сначала создайте учётную запись в панели Supabase, затем вставьте её
          идентификатор сюда. Платформа не создаёт учётные записи и не отправляет
          письма.
        </p>
        <form action={provisionPlatformStaffMemberAction} className="grid gap-3">
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="member_auth_user_id">
              Идентификатор учётной записи
            </label>
            <input
              className={inputCls}
              id="member_auth_user_id"
              name="member_auth_user_id"
              placeholder="00000000-0000-4000-8000-000000000000"
              required
            />
          </div>
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="display_name">
              Имя сотрудника
            </label>
            <input
              className={inputCls}
              id="display_name"
              name="display_name"
              required
            />
          </div>
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="new_member_role">
              Роль
            </label>
            <select
              className={inputCls}
              id="new_member_role"
              name="role"
              defaultValue="sales"
            >
              {PLATFORM_STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input name="confirm_admin" type="checkbox" value="yes" />
            Подтверждаю выдачу роли администратора. Она даёт управление
            секретами, интеграциями и экспортом аудита.
          </label>
          <div className="grid gap-1">
            <label className={labelCls} htmlFor="new_member_reason">
              Причина
            </label>
            <input
              className={inputCls}
              id="new_member_reason"
              name="reason"
              placeholder="Например: принят на работу куратором по Малайзии"
              required
            />
          </div>
          <button className={cn(btnCls, "justify-self-start")} type="submit">
            Добавить
          </button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 text-[15px] font-bold text-fg">Текущий состав</h2>
        {members === null ? (
          <EmptyState text="Служба каталога сотрудников не ответила. Состав не изменялся." />
        ) : members.length === 0 ? (
          <EmptyState text="В организации пока нет ни одной записи участника." />
        ) : (
          <ul className="grid">
            {members.map((member) => (
              <MemberRow key={member.membershipId} member={member} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
