"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls, fieldLabelCls, inputCls } from "@/components/ui";
import { createAdmissionsStudentAction } from "@/lib/admissions-direct-student-actions";
import {
  ADMISSIONS_DIRECT_CURRENCIES,
  ADMISSIONS_DIRECT_DEGREES,
  ADMISSIONS_DIRECT_MAX_PAYMENTS,
  ADMISSIONS_DIRECT_PARENT_RELATIONS,
  CHINA_DEFAULT_COST,
  EMPTY_ADMISSIONS_DIRECT_DRAFT,
  admissionsDirectCaseHref,
  admissionsDirectMessage,
  admissionsDirectServerField,
  bishkekToday,
  buildAdmissionsDirectPayload,
  minorToAmount,
  type AdmissionsDirectDraft,
  type AdmissionsDirectErrors,
  type AdmissionsDirectField,
  type AdmissionsDirectResult,
} from "@/lib/admissions-direct-student-contract";
import { ADMISSIONS_PIPELINE_TAB_STAGES } from "@/lib/platform-admissions-pipeline-contract";
import { PLATFORM_APPLICATION_COUNTRIES } from "@/lib/platform-application-contract";
import { admissionsPipelineStage, admissionsPipelineTab, country as countryLabel } from "@/lib/v3/wording";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";

export type AddStudentCuratorChoice =
  /** Куратор заводит студента только себе (своя область `case.create.direct`). */
  | Readonly<{ kind: "self"; membershipId: string }>
  /**
   * Руководитель поступления и Admin: куратор из списка тех, кого актёр может назначить
   * (`admissions_direct_curator_options_v1`), или никто («Ждут куратора»), если `withoutCurator`.
   */
  | Readonly<{
    kind: "choose";
    options: readonly Readonly<{ membershipId: string; displayName: string }>[];
    withoutCurator: boolean;
  }>;

const SELECT_CLS = `${inputCls} aria-[invalid=true]:border-danger`;
const FIELD_CLS = `${inputCls} aria-[invalid=true]:border-danger`;
const TEXT_ACTION = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg";
const CHINA_COST_MINOR = Number(CHINA_DEFAULT_COST.amount) * 100;

/** Первое поле с ошибкой в порядке формы — туда уходит фокус после проверки. */
const FIELD_ORDER: readonly AdmissionsDirectField[] = [
  "firstName", "lastName", "phone", "email", "birthDate", "age",
  "parentRelation", "parentFirstName", "parentLastName", "parentPhone",
  "country", "degree", "program", "intake", "educationCurrent", "english", "chinese",
  "curator", "stage", "costAmount", "costCurrency", "signedOn", "payments", "note",
];

/**
 * «Добавить студента» (миграция 281, решения владельца 16.10.2026) — главное
 * действие «Воронки поступления». Кнопка открывает выдвижную панель справа
 * (модальный `<dialog>`, как «Приём дела»: фон недоступен, Esc закрывает,
 * фокус возвращается на кнопку). Группы: студент, родитель, направление,
 * образование и язык, куратор и этап, деньги, заметка.
 *
 * Для Китая стоимость подставляется 1 500 USD, пока её не изменили руками.
 * Оплаты — список строк. Проверка в браузере та же, что у базы; после
 * сохранения открывается новое дело, а дело без куратора — в «Ждут куратора»,
 * где его назначают. «Сохранение не подтверждено» оставляет форму и ключ
 * запроса: повтор безопасен.
 */
export function AddStudentDrawer({ curator }: Readonly<{ curator: AddStudentCuratorChoice }>) {
  const router = useRouter();
  // Ключ запроса живёт с панелью: повтор после «не подтверждено» идёт с тем же
  // ключом, а возврат на доску (новый экземпляр) начинает новый запрос.
  const [requestId] = useState(() => crypto.randomUUID());
  const headingId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Без права оставить дело без куратора выбор обязателен: первым стоит первый из списка.
  const curatorRequired = curator.kind === "choose" && !curator.withoutCurator;
  const [draft, setDraft] = useState<AdmissionsDirectDraft>(() => ({
    ...EMPTY_ADMISSIONS_DIRECT_DRAFT,
    curator: curator.kind === "self" ? curator.membershipId
      : curatorRequired ? curator.options[0]?.membershipId ?? "" : "",
  }));
  // Стоимость Китая подставлена и ещё не тронута руками.
  const [costPrefilled, setCostPrefilled] = useState(false);
  const [errors, setErrors] = useState<AdmissionsDirectErrors>({});
  const [paymentErrors, setPaymentErrors] = useState<readonly (string | null)[]>([]);
  const [result, setResult] = useState<AdmissionsDirectResult | null>(null);
  const [pending, setPending] = useState(false);
  const statusId = useId();
  const ids = useFieldIds();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  const open = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    document.getElementById(ids.firstName)?.focus();
  };
  const close = () => dialogRef.current?.close();

  const set = <K extends keyof AdmissionsDirectDraft>(key: K, value: AdmissionsDirectDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const chooseCountry = (value: string) => {
    const untouched = draft.costAmount.trim() === "" || costPrefilled;
    if (value === "CN" && untouched) {
      setCostPrefilled(true);
      setDraft({ ...draft, country: value, costAmount: minorToAmount(CHINA_COST_MINOR), costCurrency: CHINA_DEFAULT_COST.currency });
    } else if (value !== "CN" && costPrefilled) {
      setCostPrefilled(false);
      setDraft({ ...draft, country: value, costAmount: "", costCurrency: "USD" });
    } else {
      setDraft({ ...draft, country: value });
    }
    setErrors((current) => ({ ...current, country: undefined, costAmount: undefined, costCurrency: undefined }));
  };

  const setPayment = (index: number, key: "amount" | "currency" | "paidOn", value: string) => {
    setDraft((current) => ({
      ...current,
      payments: current.payments.map((payment, i) => (i === index ? { ...payment, [key]: value } : payment)),
    }));
    setPaymentErrors((current) => current.map((error, i) => (i === index ? null : error)));
  };
  const addPayment = () => {
    setDraft((current) => ({
      ...current,
      payments: [...current.payments, { amount: "", currency: current.costCurrency || "USD", paidOn: bishkekToday() }],
    }));
    requestAnimationFrame(() => {
      const rows = formRef.current?.querySelectorAll<HTMLInputElement>("[data-payment-amount]");
      rows?.[rows.length - 1]?.focus();
    });
  };
  const removePayment = (index: number) => {
    setDraft((current) => ({ ...current, payments: current.payments.filter((_, i) => i !== index) }));
    setPaymentErrors((current) => current.filter((_, i) => i !== index));
    setErrors((current) => ({ ...current, payments: undefined }));
  };

  const focusFirstError = (fieldErrors: AdmissionsDirectErrors, rowErrors: readonly (string | null)[]) => {
    const field = FIELD_ORDER.find((key) => fieldErrors[key]);
    requestAnimationFrame(() => {
      if (field === "payments" || (!field && rowErrors.some(Boolean))) {
        const row = rowErrors.findIndex(Boolean);
        const target = row >= 0
          ? formRef.current?.querySelectorAll<HTMLInputElement>("[data-payment-amount]")[row]
          : document.getElementById(ids.payments);
        target?.focus();
        return;
      }
      if (field) document.getElementById(ids[field])?.focus();
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const built = buildAdmissionsDirectPayload(draft);
    setResult(null);
    const curatorMissing = curatorRequired && draft.curator.trim() === "";
    if (!built.ok || curatorMissing) {
      const fieldErrors: AdmissionsDirectErrors = {
        ...(built.ok ? {} : built.errors),
        ...(curatorMissing ? { curator: "Выберите куратора из списка." } : {}),
      };
      const rowErrors = built.ok ? [] : built.paymentErrors;
      setErrors(fieldErrors);
      setPaymentErrors(rowErrors);
      focusFirstError(fieldErrors, rowErrors);
      return;
    }
    setErrors({});
    setPaymentErrors([]);
    setPending(true);
    let answer: AdmissionsDirectResult;
    try {
      answer = await createAdmissionsStudentAction({ requestId, payload: built.payload });
    } catch {
      answer = { status: "unavailable" };
    }
    setResult(answer);
    if (answer.status === "saved") {
      router.push(admissionsDirectCaseHref(answer));
      return;
    }
    setPending(false);
    // Отказ по куратору: подсказка под полем «Куратор», фокус туда же.
    if (answer.status === "curator_forbidden" && curator.kind === "choose") {
      const fieldErrors: AdmissionsDirectErrors = { curator: admissionsDirectMessage(answer) };
      setErrors(fieldErrors);
      focusFirstError(fieldErrors, []);
      return;
    }
    if (answer.status === "invalid") {
      const field = admissionsDirectServerField(answer.field);
      if (field) {
        const fieldErrors = { [field]: admissionsDirectMessage(answer) } as AdmissionsDirectErrors;
        setErrors(fieldErrors);
        focusFirstError(fieldErrors, []);
      }
    }
  };

  const error = (field: AdmissionsDirectField) => errors[field];
  const fieldProps = (field: AdmissionsDirectField) => ({
    id: ids[field],
    "aria-invalid": error(field) ? true : undefined,
    "aria-describedby": error(field) ? `${ids[field]}-error` : undefined,
  });
  const errorText = (field: AdmissionsDirectField) => error(field)
    ? <span id={`${ids[field]}-error`} className="mt-1 block t-body-compact text-danger">{error(field)}</span>
    : null;
  const saved = result?.status === "saved";

  return <>
    <button ref={triggerRef} type="button" aria-haspopup="dialog" onClick={open} className={btnCls}
      data-testid="v3-admissions-add-student">
      <Icon name="plus" size={18} />
      Добавить студента
    </button>
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      data-testid="v3-admissions-add-student-drawer"
      className="fixed inset-y-0 end-0 start-auto m-0 h-dvh max-h-none w-full max-w-[40rem] overflow-y-auto border-0 border-s border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/45"
    >
      <form ref={formRef} noValidate onSubmit={submit} aria-busy={pending} className="flex min-h-full flex-col">
        <div className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-border bg-surface ps-4 pe-2">
          <h2 id={headingId} className="t-section min-w-0 flex-1 truncate text-fg">Новый студент</h2>
          <button type="button" onClick={close} aria-label="Закрыть"
            className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
            <Icon name="x" size={20} />
          </button>
        </div>

        <fieldset disabled={pending || saved} className="flex-1 space-y-6 p-4">
          <Group title="Студент">
            <Field label="Имя" htmlFor={ids.firstName} required>
              <input {...fieldProps("firstName")} name="firstName" autoComplete="off" maxLength={60} className={FIELD_CLS}
                value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} required />
              {errorText("firstName")}
            </Field>
            <Field label="Фамилия" htmlFor={ids.lastName}>
              <input {...fieldProps("lastName")} name="lastName" autoComplete="off" maxLength={60} className={FIELD_CLS}
                value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
              {errorText("lastName")}
            </Field>
            <Field label="Телефон" htmlFor={ids.phone}>
              <input {...fieldProps("phone")} name="phone" type="tel" autoComplete="off" maxLength={40} className={FIELD_CLS}
                placeholder="+996 555 123 456" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
              {errorText("phone")}
            </Field>
            <Field label="Почта" htmlFor={ids.email}>
              <input {...fieldProps("email")} name="email" type="email" autoComplete="off" maxLength={120} className={FIELD_CLS}
                value={draft.email} onChange={(e) => set("email", e.target.value)} />
              {errorText("email")}
            </Field>
            <Field label="Дата рождения" htmlFor={ids.birthDate}>
              <input {...fieldProps("birthDate")} name="birthDate" type="date" max={bishkekToday()} className={FIELD_CLS}
                value={draft.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
              {errorText("birthDate")}
            </Field>
            <Field label="Возраст, если даты нет" htmlFor={ids.age}>
              <input {...fieldProps("age")} name="age" inputMode="numeric" maxLength={2} className={FIELD_CLS}
                disabled={draft.birthDate !== ""} value={draft.birthDate !== "" ? "" : draft.age}
                onChange={(e) => set("age", e.target.value)} />
              {errorText("age")}
            </Field>
          </Group>

          <Group title="Родитель">
            <Field label="Кем приходится" htmlFor={ids.parentRelation}>
              <select {...fieldProps("parentRelation")} name="parentRelation" className={SELECT_CLS}
                value={draft.parentRelation} onChange={(e) => set("parentRelation", e.target.value)}>
                <option value="">Не выбрано</option>
                {Object.entries(ADMISSIONS_DIRECT_PARENT_RELATIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              {errorText("parentRelation")}
            </Field>
            <Field label="Телефон родителя" htmlFor={ids.parentPhone}>
              <input {...fieldProps("parentPhone")} name="parentPhone" type="tel" autoComplete="off" maxLength={40} className={FIELD_CLS}
                placeholder="+996 555 123 456" value={draft.parentPhone} onChange={(e) => set("parentPhone", e.target.value)} />
              {errorText("parentPhone")}
            </Field>
            <Field label="Имя родителя" htmlFor={ids.parentFirstName}>
              <input {...fieldProps("parentFirstName")} name="parentFirstName" autoComplete="off" maxLength={60} className={FIELD_CLS}
                value={draft.parentFirstName} onChange={(e) => set("parentFirstName", e.target.value)} />
              {errorText("parentFirstName")}
            </Field>
            <Field label="Фамилия родителя" htmlFor={ids.parentLastName}>
              <input {...fieldProps("parentLastName")} name="parentLastName" autoComplete="off" maxLength={60} className={FIELD_CLS}
                value={draft.parentLastName} onChange={(e) => set("parentLastName", e.target.value)} />
              {errorText("parentLastName")}
            </Field>
          </Group>

          <Group title="Направление">
            <Field label="Страна" htmlFor={ids.country} required>
              <select {...fieldProps("country")} name="country" className={SELECT_CLS} required
                value={draft.country} onChange={(e) => chooseCountry(e.target.value)}>
                <option value="">Не выбрано</option>
                {PLATFORM_APPLICATION_COUNTRIES.map((code) => <option key={code} value={code}>{countryLabel(code) ?? code}</option>)}
              </select>
              {errorText("country")}
            </Field>
            <Field label="Ступень" htmlFor={ids.degree}>
              <select {...fieldProps("degree")} name="degree" className={SELECT_CLS}
                value={draft.degree} onChange={(e) => set("degree", e.target.value)}>
                <option value="">Не выбрано</option>
                {ADMISSIONS_DIRECT_DEGREES.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
              {errorText("degree")}
            </Field>
            <Field label="Программа" htmlFor={ids.program}>
              <input {...fieldProps("program")} name="program" autoComplete="off" maxLength={100} className={FIELD_CLS}
                value={draft.program} onChange={(e) => set("program", e.target.value)} />
              {errorText("program")}
            </Field>
            <Field label="Набор" htmlFor={ids.intake}>
              <input {...fieldProps("intake")} name="intake" autoComplete="off" maxLength={30} className={FIELD_CLS}
                placeholder="например, сентябрь 2027" value={draft.intake} onChange={(e) => set("intake", e.target.value)} />
              {errorText("intake")}
            </Field>
          </Group>

          <Group title="Образование и язык">
            <Field label="Где учится сейчас" htmlFor={ids.educationCurrent} wide>
              <input {...fieldProps("educationCurrent")} name="educationCurrent" autoComplete="off" maxLength={100} className={FIELD_CLS}
                placeholder="например, 11 класс" value={draft.educationCurrent}
                onChange={(e) => set("educationCurrent", e.target.value)} />
              {errorText("educationCurrent")}
            </Field>
            <Field label="Английский" htmlFor={ids.english}>
              <input {...fieldProps("english")} name="english" autoComplete="off" maxLength={60} className={FIELD_CLS}
                placeholder="например, IELTS 6.0" value={draft.english} onChange={(e) => set("english", e.target.value)} />
              {errorText("english")}
            </Field>
            <Field label="Китайский" htmlFor={ids.chinese}>
              <input {...fieldProps("chinese")} name="chinese" autoComplete="off" maxLength={40} className={FIELD_CLS}
                placeholder="например, HSK 3" value={draft.chinese} onChange={(e) => set("chinese", e.target.value)} />
              {errorText("chinese")}
            </Field>
          </Group>

          <Group title="Куратор и этап">
            {curator.kind === "self" ? (
              <div className="min-w-0">
                <span className={fieldLabelCls}>Куратор</span>
                <p className="flex min-h-11 items-center t-body text-fg">Вы</p>
              </div>
            ) : (
              <Field label="Куратор" htmlFor={ids.curator}>
                <select {...fieldProps("curator")} name="curator" className={SELECT_CLS}
                  value={draft.curator} onChange={(e) => set("curator", e.target.value)}>
                  {curator.withoutCurator ? <option value="">Без куратора: ждёт назначения</option>
                    : curator.options.length === 0 ? <option value="">Нет кураторов, которых вы можете назначить</option> : null}
                  {curator.options.map((option) => <option key={option.membershipId} value={option.membershipId}>{option.displayName}</option>)}
                </select>
                {errorText("curator")}
              </Field>
            )}
            <Field label="Этап на доске" htmlFor={ids.stage}>
              <select {...fieldProps("stage")} name="stage" className={SELECT_CLS}
                value={draft.stage} onChange={(e) => set("stage", e.target.value)}>
                {(["admission", "visa"] as const).map((tab) => (
                  <optgroup key={tab} label={admissionsPipelineTab(tab)}>
                    {ADMISSIONS_PIPELINE_TAB_STAGES[tab].map((stage) => (
                      <option key={stage} value={stage}>{admissionsPipelineStage(stage) ?? stage}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {errorText("stage")}
            </Field>
          </Group>

          <Group title="Деньги">
            <div className="min-w-0 sm:col-span-2">
              <span className={fieldLabelCls} id={`${ids.costAmount}-label`}>Стоимость договора</span>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <input {...fieldProps("costAmount")} aria-labelledby={`${ids.costAmount}-label`} name="costAmount"
                  inputMode="decimal" autoComplete="off" maxLength={18} className={`${FIELD_CLS} tabular-nums`}
                  value={draft.costAmount} onChange={(e) => { setCostPrefilled(false); set("costAmount", e.target.value); }} />
                <select {...fieldProps("costCurrency")} aria-label="Валюта договора" name="costCurrency"
                  className={SELECT_CLS} value={draft.costCurrency}
                  onChange={(e) => { setCostPrefilled(false); set("costCurrency", e.target.value); }}>
                  {ADMISSIONS_DIRECT_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </div>
              {errorText("costAmount") ?? errorText("costCurrency")
                ?? (costPrefilled ? <span className="mt-1 block t-meta text-fg-2">По умолчанию для Китая.</span> : null)}
            </div>
            <Field label="Дата договора" htmlFor={ids.signedOn}>
              <input {...fieldProps("signedOn")} name="signedOn" type="date" max={bishkekToday()} className={FIELD_CLS}
                value={draft.signedOn} onChange={(e) => set("signedOn", e.target.value)} />
              {errorText("signedOn")}
            </Field>

            <div className="min-w-0 sm:col-span-2" role="group" aria-labelledby={`${ids.payments}-label`}>
              <span className={fieldLabelCls} id={`${ids.payments}-label`}>Полученные оплаты</span>
              {draft.payments.length > 0 ? (
                <ul className="space-y-2">
                  {draft.payments.map((payment, index) => {
                    const rowError = paymentErrors[index] ?? null;
                    const rowErrorId = `${ids.payments}-row-${index}`;
                    return (
                      <li key={index} className="rounded-ctl border border-border p-2">
                        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_10rem_auto]">
                          <input data-payment-amount aria-label={`Сумма оплаты ${index + 1}`} inputMode="decimal" autoComplete="off"
                            maxLength={18} className={`${FIELD_CLS} tabular-nums`} value={payment.amount}
                            aria-invalid={rowError ? true : undefined} aria-describedby={rowError ? rowErrorId : undefined}
                            onChange={(e) => setPayment(index, "amount", e.target.value)} />
                          <select aria-label={`Валюта оплаты ${index + 1}`} className={SELECT_CLS} value={payment.currency}
                            onChange={(e) => setPayment(index, "currency", e.target.value)}>
                            {ADMISSIONS_DIRECT_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                          </select>
                          <input type="date" aria-label={`Дата оплаты ${index + 1}`} className={FIELD_CLS} value={payment.paidOn}
                            max={bishkekToday()} onChange={(e) => setPayment(index, "paidOn", e.target.value)} />
                          <button type="button" onClick={() => removePayment(index)} aria-label={`Убрать оплату ${index + 1}`}
                            className="flex size-11 items-center justify-center justify-self-end rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
                            <Icon name="x" size={18} />
                          </button>
                        </div>
                        {rowError ? <span id={rowErrorId} className="mt-1 block t-body-compact text-danger">{rowError}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {draft.payments.length < ADMISSIONS_DIRECT_MAX_PAYMENTS ? (
                <button type="button" id={ids.payments} onClick={addPayment} className={TEXT_ACTION}>
                  <Icon name="plus" size={16} />
                  Добавить оплату
                </button>
              ) : null}
              {error("payments") ? <span role="alert" className="mt-1 block t-body-compact text-danger">{error("payments")}</span> : null}
            </div>
          </Group>

          <Group title="Заметка">
            <Field label="Что важно знать куратору" htmlFor={ids.note} wide>
              <textarea {...fieldProps("note")} name="note" rows={3} maxLength={3500} className={`${FIELD_CLS} h-auto py-2`}
                value={draft.note} onChange={(e) => set("note", e.target.value)} />
              {errorText("note")}
            </Field>
          </Group>
        </fieldset>

        <div className="sticky bottom-0 z-10 space-y-2 border-t border-border bg-surface p-4">
          {result && result.status !== "saved" ? (
            <p id={statusId} role="alert" className="t-body-compact text-danger">{admissionsDirectMessage(result)}</p>
          ) : saved ? (
            <p id={statusId} role="status" className="t-body-compact text-fg-2">{admissionsDirectMessage(result)}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} className={QUEUE_SECONDARY}>Отмена</button>
            <button type="submit" className={QUEUE_CONFIRM} disabled={pending || saved}>
              {pending || saved ? "Сохраняем…" : result?.status === "unavailable" ? "Повторить" : "Добавить студента"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  </>;
}

function Group({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 t-item text-fg">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({ label, htmlFor, required = false, wide = false, children }: Readonly<{
  label: string; htmlFor: string; required?: boolean; wide?: boolean; children: ReactNode;
}>) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <label htmlFor={htmlFor} className={fieldLabelCls}>
        {label}
        {required ? <span className="text-fg-3"> · обязательно</span> : null}
      </label>
      {children}
    </div>
  );
}

function useFieldIds(): Readonly<Record<AdmissionsDirectField, string>> {
  const base = useId();
  return Object.fromEntries(FIELD_ORDER.map((field) => [field, `${base}-${field}`])) as Record<AdmissionsDirectField, string>;
}
