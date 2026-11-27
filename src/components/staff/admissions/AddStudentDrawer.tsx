"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import { createAdmissionsStudentAction } from "@/lib/admissions-direct-student-actions";
import {
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

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { DetailsSection, DraftAvatar, sectionSummary, type AddStudentSection } from "./AddStudentDetails";
import {
  MainFields,
  NoteFields,
  ParentFields,
  RouteMoreFields,
  StudentMoreFields,
  StudyFields,
  TEXT_ACTION,
  type AddStudentForm,
} from "./AddStudentFields";
import { MoneyFields } from "./AddStudentMoney";

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

const CHINA_COST_MINOR = Number(CHINA_DEFAULT_COST.amount) * 100;

/** «Главное» открыто всегда: в нём оба обязательных поля — имя и страна. */
const MAIN_FIELDS: readonly AdmissionsDirectField[] = ["firstName", "lastName", "phone", "country", "curator", "salesName"];

/** Раскрытия под «Главным» в порядке на экране; поля — в порядке внутри раскрытия. */
const SECTIONS: readonly Readonly<{ key: AddStudentSection; title: string; fields: readonly AdmissionsDirectField[] }>[] = [
  { key: "student", title: "Студент подробнее", fields: ["email", "birthDate", "age"] },
  { key: "parent", title: "Родитель", fields: ["parentRelation", "parentPhone", "parentFirstName", "parentLastName"] },
  { key: "route", title: "Направление подробнее", fields: ["degree", "intake", "program"] },
  { key: "study", title: "Учёба и язык", fields: ["educationCurrent", "english", "chinese"] },
  { key: "money", title: "Этап и деньги", fields: ["stage", "costAmount", "costCurrency", "signedOn", "payments"] },
  { key: "note", title: "Заметка", fields: ["note"] },
];

/** Первое поле с ошибкой в порядке формы на экране — туда уходит фокус после проверки. */
const FIELD_ORDER: readonly AdmissionsDirectField[] = [...MAIN_FIELDS, ...SECTIONS.flatMap((section) => section.fields)];

/** Куда встаёт фокус после проверки: поле, строка оплаты или «Добавить оплату». */
type FocusRequest =
  | Readonly<{ kind: "field"; field: AdmissionsDirectField }>
  | Readonly<{ kind: "payment"; row: number }>
  | Readonly<{ kind: "payments" }>;

/**
 * «Добавить студента» (миграция 281, решения владельца 16.10.2026) — главное
 * действие «Воронки поступления». Кнопка открывает выдвижную панель справа
 * (модальный `<dialog>`, как «Приём дела»: фон недоступен, Esc закрывает,
 * фокус возвращается на кнопку).
 *
 * Вариант «Главное и подробности»: белые листы на сером столе панели. Сверху
 * всегда открыто «Главное» — имя, фамилия, телефон, страна, куратор и
 * продажник (оба обязательных поля на первом экране). Ниже одна карточка
 * раскрытий: «Студент подробнее», «Родитель», «Направление подробнее»,
 * «Учёба и язык», «Этап и деньги», «Заметка»; свёрнутое раскрытие одной
 * строкой называет, что в нём уже заполнено. После неудачной проверки
 * раскрытия с ошибками открываются, фокус встаёт на первое неверное поле.
 *
 * Для Китая стоимость подставляется 1 500 USD, пока её не изменили руками —
 * и при свёрнутом «Этап и деньги» (строка раскрытия называет её «по умолчанию
 * для Китая», пока цену не набрали руками). Оплаты —
 * список строк. Проверка в браузере та же, что у базы; после сохранения
 * открывается новое дело, а дело без куратора — в «Ждут куратора», где его
 * назначают. «Сохранение не подтверждено» оставляет форму и ключ запроса:
 * повтор безопасен.
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
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
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
  const [openSections, setOpenSections] = useState<ReadonlySet<AddStudentSection>>(() => new Set());
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
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

  // Фокус на первую ошибку — после отрисовки, когда раскрытия с ошибками уже открыты.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const target = focusRequest.kind === "field" ? document.getElementById(ids[focusRequest.field])
        : focusRequest.kind === "payment"
          ? formRef.current?.querySelectorAll<HTMLInputElement>("[data-payment-amount]")[focusRequest.row]
          : document.getElementById(ids.payments);
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, ids]);

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
  const setCost = (key: "costAmount" | "costCurrency", value: string) => {
    setCostPrefilled(false);
    set(key, value);
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

  // Раскрытие у нижнего края (на телефоне — почти всегда) подтягивается в видимую часть, но не выше своей строки.
  const revealSection = (key: AddStudentSection) => {
    const dialog = dialogRef.current;
    const section = formRef.current?.querySelector<HTMLElement>(`[data-add-section="${key}"]`);
    const top = headerRef.current?.getBoundingClientRect().bottom;
    const bottom = footerRef.current?.getBoundingClientRect().top;
    if (!dialog || !section || top === undefined || bottom === undefined) return;
    const box = section.getBoundingClientRect();
    const by = Math.min(box.bottom + 16 - bottom, box.top - 16 - top);
    if (by <= 0) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dialog.scrollBy({ top: by, behavior: still ? "auto" : "smooth" });
  };
  const toggleSection = (key: AddStudentSection) => {
    const opening = !openSections.has(key);
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (opening) requestAnimationFrame(() => revealSection(key));
  };

  // Сначала открываются раскрытия с ошибками, потом (эффект выше) фокус встаёт на первое неверное поле.
  const focusFirstError = (fieldErrors: AdmissionsDirectErrors, rowErrors: readonly (string | null)[]) => {
    const rowsInvalid = rowErrors.some(Boolean);
    const withErrors = SECTIONS
      .filter((section) => section.fields.some((key) => fieldErrors[key]) || (section.key === "money" && rowsInvalid))
      .map((section) => section.key);
    if (withErrors.length > 0) setOpenSections((current) => new Set([...current, ...withErrors]));
    const field = FIELD_ORDER.find((key) => fieldErrors[key]);
    if (field === "payments" || (!field && rowsInvalid)) {
      const row = rowErrors.findIndex(Boolean);
      setFocusRequest(row >= 0 ? { kind: "payment", row } : { kind: "payments" });
    } else if (field) {
      setFocusRequest({ kind: "field", field });
    }
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
  const form: AddStudentForm = {
    draft,
    ids,
    set,
    error,
    field: (field) => ({
      id: ids[field],
      "aria-invalid": error(field) ? true : undefined,
      "aria-describedby": error(field) ? `${ids[field]}-error` : undefined,
    }),
    errorText: (field) => error(field)
      ? <span id={`${ids[field]}-error`} className="mt-1 block t-body-compact text-danger">{error(field)}</span>
      : null,
  };
  const bodies: Readonly<Record<AddStudentSection, ReactNode>> = {
    student: <StudentMoreFields form={form} />,
    parent: <ParentFields form={form} />,
    route: <RouteMoreFields form={form} />,
    study: <StudyFields form={form} />,
    money: (
      <MoneyFields form={form} costPrefilled={costPrefilled} onCost={setCost} paymentErrors={paymentErrors}
        onPayment={setPayment} onAddPayment={addPayment} onRemovePayment={removePayment} />
    ),
    note: <NoteFields form={form} />,
  };
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
      className="fixed inset-y-0 end-0 start-auto m-0 h-dvh max-h-none w-full max-w-[40rem] scroll-pt-20 scroll-pb-24 overflow-y-auto overscroll-contain border-0 border-s border-border bg-bg p-0 text-fg shadow-evo-lg backdrop:bg-black/45 animate-in fade-in slide-in-from-right-6 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none"
    >
      <form ref={formRef} noValidate onSubmit={submit} aria-busy={pending} className="flex min-h-full flex-col">
        <div ref={headerRef} className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-border bg-surface ps-4 pe-2">
          <DraftAvatar firstName={draft.firstName} lastName={draft.lastName} />
          <h2 id={headingId} className="t-section min-w-0 flex-1 truncate text-fg">Новый студент</h2>
          <button type="button" onClick={close} aria-label="Закрыть"
            className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
            <Icon name="x" size={20} />
          </button>
        </div>

        <fieldset disabled={pending || saved} className="min-w-0 flex-1 space-y-4 p-4">
          <div className="rounded-card border border-border bg-surface px-4 pb-5 pt-4 sm:px-5">
            <fieldset className="min-w-0">
              <legend className="mb-4 t-item text-fg">Главное</legend>
              <MainFields form={form} curator={curator} onCountry={chooseCountry} />
            </fieldset>
          </div>

          <div className="divide-y divide-border rounded-card border border-border bg-surface">
            {SECTIONS.map((section, index) => (
              <DetailsSection key={section.key} name={section.key} title={section.title}
                summary={sectionSummary(section.key, draft, costPrefilled)}
                invalid={section.fields.some((key) => errors[key]) || (section.key === "money" && paymentErrors.some(Boolean))}
                open={openSections.has(section.key)} first={index === 0} last={index === SECTIONS.length - 1}
                onToggle={() => toggleSection(section.key)}>
                {bodies[section.key]}
              </DetailsSection>
            ))}
          </div>
        </fieldset>

        <div ref={footerRef} className="sticky bottom-0 z-10 space-y-2 border-t border-border bg-surface p-4">
          {result && result.status !== "saved" ? (
            <div>
              <p id={statusId} role="alert" className="t-body-compact text-danger">{admissionsDirectMessage(result)}</p>
              {result.status === "lead_exists" && result.leadId ? (
                <Link href={`/profile?id=${encodeURIComponent(result.leadId)}`} className={TEXT_ACTION}>Открыть лид</Link>
              ) : null}
            </div>
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

function useFieldIds(): Readonly<Record<AdmissionsDirectField, string>> {
  const base = useId();
  return useMemo(
    () => Object.fromEntries(FIELD_ORDER.map((field) => [field, `${base}-${field}`])) as Record<AdmissionsDirectField, string>,
    [base],
  );
}
