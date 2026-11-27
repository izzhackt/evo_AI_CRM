"use client";

import type { ReactNode } from "react";

import { fieldLabelCls, inputCls } from "@/components/ui";
import {
  ADMISSIONS_DIRECT_CHINESE,
  ADMISSIONS_DIRECT_DEGREES,
  ADMISSIONS_DIRECT_EDUCATION_CURRENT,
  ADMISSIONS_DIRECT_ENGLISH,
  ADMISSIONS_DIRECT_PARENT_RELATIONS,
  ADMISSIONS_DIRECT_SALES_NAME_MAX,
  ADMISSIONS_DIRECT_UNSPECIFIED,
  bishkekToday,
  type AdmissionsDirectDraft,
  type AdmissionsDirectField,
} from "@/lib/admissions-direct-student-contract";
import { PLATFORM_APPLICATION_COUNTRIES } from "@/lib/platform-application-contract";
import { country as countryLabel } from "@/lib/v3/wording";

import type { AddStudentCuratorChoice } from "./AddStudentDrawer";

export const FIELD_CLS = `${inputCls} aria-[invalid=true]:border-danger`;
export const TEXT_ACTION = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg";
/** Поле во всю ширину раскрытия (на телефоне все поля и так во всю ширину). */
export const WIDE = "sm:col-span-2";

/** Черновик и то, что каждому полю нужно от формы: значение, id, отметка ошибки и её текст. */
export type AddStudentForm = Readonly<{
  draft: AdmissionsDirectDraft;
  ids: Readonly<Record<AdmissionsDirectField, string>>;
  set: <K extends keyof AdmissionsDirectDraft>(key: K, value: AdmissionsDirectDraft[K]) => void;
  error: (field: AdmissionsDirectField) => string | undefined;
  field: (field: AdmissionsDirectField) => Readonly<{
    id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined;
  }>;
  errorText: (field: AdmissionsDirectField) => ReactNode;
}>;

export function Field({ label, htmlFor, required = false, className = "", children }: Readonly<{
  label: string; htmlFor: string; required?: boolean; className?: string; children: ReactNode;
}>) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className={fieldLabelCls}>
        {label}
        {required ? <span className="text-fg-3"> · обязательно</span> : null}
      </label>
      {children}
    </div>
  );
}

/**
 * «Главное» — открыто всегда: оба обязательных поля (имя и страна), телефон, куратор и продажник.
 * С ширины sm поля стоят парами (кроме списка кураторов, см. ниже), на телефоне каждое — во всю ширину.
 */
export function MainFields({ form, curator, onCountry }: Readonly<{
  form: AddStudentForm; curator: AddStudentCuratorChoice; onCountry: (value: string) => void;
}>) {
  const { draft, ids, set, field, errorText } = form;
  const cell = "col-span-2 sm:col-span-1";
  // Список кураторов («Без куратора: ждёт назначения», длинные имена) в половину панели не помещается:
  // тогда куратор и продажник стоят каждый во всю ширину. «Вы» и продажник помещаются парой.
  const people = curator.kind === "self" ? cell : "col-span-2";
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4">
      <Field label="Имя" htmlFor={ids.firstName} required className={cell}>
        <input {...field("firstName")} name="firstName" autoComplete="off" maxLength={60} className={FIELD_CLS}
          value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} required />
        {errorText("firstName")}
      </Field>
      <Field label="Фамилия" htmlFor={ids.lastName} className={cell}>
        <input {...field("lastName")} name="lastName" autoComplete="off" maxLength={60} className={FIELD_CLS}
          value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
        {errorText("lastName")}
      </Field>
      <Field label="Телефон" htmlFor={ids.phone} className={cell}>
        <input {...field("phone")} name="phone" type="tel" autoComplete="off" maxLength={40} className={FIELD_CLS}
          placeholder="+996 555 123 456" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
        {errorText("phone")}
      </Field>
      <Field label="Страна" htmlFor={ids.country} required className={cell}>
        <select {...field("country")} name="country" className={FIELD_CLS} required
          value={draft.country} onChange={(e) => onCountry(e.target.value)}>
          <option value="">Не выбрано</option>
          {PLATFORM_APPLICATION_COUNTRIES.map((code) => <option key={code} value={code}>{countryLabel(code) ?? code}</option>)}
        </select>
        {errorText("country")}
      </Field>
      {curator.kind === "self" ? (
        <div className={`min-w-0 ${people}`}>
          <span className={fieldLabelCls}>Куратор</span>
          <p className="flex min-h-11 items-center t-body text-fg">Вы</p>
        </div>
      ) : (
        <Field label="Куратор" htmlFor={ids.curator} className={people}>
          <select {...field("curator")} name="curator" className={FIELD_CLS}
            value={draft.curator} onChange={(e) => set("curator", e.target.value)}>
            {curator.withoutCurator ? <option value="">Без куратора: ждёт назначения</option>
              : curator.options.length === 0 ? <option value="">Нет кураторов, которых вы можете назначить</option> : null}
            {curator.options.map((option) => <option key={option.membershipId} value={option.membershipId}>{option.displayName}</option>)}
          </select>
          {errorText("curator")}
        </Field>
      )}
      {/* 27.11.2026, решение владельца: от какого продажника пришёл клиент — имя словами; уходит первой строкой заметки. */}
      <Field label="Продажник" htmlFor={ids.salesName} className={people}>
        <input {...field("salesName")} name="salesName" autoComplete="off" maxLength={ADMISSIONS_DIRECT_SALES_NAME_MAX}
          className={FIELD_CLS} placeholder="Имя, если клиент от продаж" value={draft.salesName}
          onChange={(e) => set("salesName", e.target.value)} />
        {errorText("salesName")}
      </Field>
    </div>
  );
}

/** «Студент подробнее»: почта, дата рождения или возраст. */
export function StudentMoreFields({ form }: Readonly<{ form: AddStudentForm }>) {
  const { draft, ids, set, field, errorText } = form;
  return <>
    <Field label="Почта" htmlFor={ids.email} className={WIDE}>
      <input {...field("email")} name="email" type="email" autoComplete="off" maxLength={120} className={FIELD_CLS}
        value={draft.email} onChange={(e) => set("email", e.target.value)} />
      {errorText("email")}
    </Field>
    <Field label="Дата рождения" htmlFor={ids.birthDate}>
      <input {...field("birthDate")} name="birthDate" type="date" max={bishkekToday()} className={FIELD_CLS}
        value={draft.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
      {errorText("birthDate")}
    </Field>
    <Field label="Возраст, если даты нет" htmlFor={ids.age}>
      <input {...field("age")} name="age" inputMode="numeric" maxLength={2} className={FIELD_CLS}
        disabled={draft.birthDate !== ""} value={draft.birthDate !== "" ? "" : draft.age}
        onChange={(e) => set("age", e.target.value)} />
      {errorText("age")}
    </Field>
  </>;
}

/** «Родитель»: кем приходится и телефон — первой строкой, имя и фамилия — второй. */
export function ParentFields({ form }: Readonly<{ form: AddStudentForm }>) {
  const { draft, ids, set, field, errorText } = form;
  return <>
    <Field label="Кем приходится" htmlFor={ids.parentRelation}>
      <select {...field("parentRelation")} name="parentRelation" className={FIELD_CLS}
        value={draft.parentRelation} onChange={(e) => set("parentRelation", e.target.value)}>
        <option value="">Не выбрано</option>
        {Object.entries(ADMISSIONS_DIRECT_PARENT_RELATIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      {errorText("parentRelation")}
    </Field>
    <Field label="Телефон родителя" htmlFor={ids.parentPhone}>
      <input {...field("parentPhone")} name="parentPhone" type="tel" autoComplete="off" maxLength={40} className={FIELD_CLS}
        placeholder="+996 555 123 456" value={draft.parentPhone} onChange={(e) => set("parentPhone", e.target.value)} />
      {errorText("parentPhone")}
    </Field>
    <Field label="Имя родителя" htmlFor={ids.parentFirstName}>
      <input {...field("parentFirstName")} name="parentFirstName" autoComplete="off" maxLength={60} className={FIELD_CLS}
        value={draft.parentFirstName} onChange={(e) => set("parentFirstName", e.target.value)} />
      {errorText("parentFirstName")}
    </Field>
    <Field label="Фамилия родителя" htmlFor={ids.parentLastName}>
      <input {...field("parentLastName")} name="parentLastName" autoComplete="off" maxLength={60} className={FIELD_CLS}
        value={draft.parentLastName} onChange={(e) => set("parentLastName", e.target.value)} />
      {errorText("parentLastName")}
    </Field>
  </>;
}

/** «Направление подробнее»: ступень и набор, ниже программа во всю ширину. */
export function RouteMoreFields({ form }: Readonly<{ form: AddStudentForm }>) {
  const { draft, ids, set, field, errorText } = form;
  return <>
    <Field label="Ступень" htmlFor={ids.degree}>
      <select {...field("degree")} name="degree" className={FIELD_CLS}
        value={draft.degree} onChange={(e) => set("degree", e.target.value)}>
        <option value="">Не выбрано</option>
        {ADMISSIONS_DIRECT_DEGREES.map((label) => <option key={label} value={label}>{label}</option>)}
      </select>
      {errorText("degree")}
    </Field>
    <Field label="Набор" htmlFor={ids.intake}>
      <input {...field("intake")} name="intake" autoComplete="off" maxLength={30} className={FIELD_CLS}
        placeholder="например, сентябрь 2027" value={draft.intake} onChange={(e) => set("intake", e.target.value)} />
      {errorText("intake")}
    </Field>
    <Field label="Программа" htmlFor={ids.program} className={WIDE}>
      <input {...field("program")} name="program" autoComplete="off" maxLength={100} className={FIELD_CLS}
        value={draft.program} onChange={(e) => set("program", e.target.value)} />
      {errorText("program")}
    </Field>
  </>;
}

/** «Учёба и язык»: где учится сейчас, английский, китайский. */
export function StudyFields({ form }: Readonly<{ form: AddStudentForm }>) {
  const { draft, ids, set, field, errorText } = form;
  const levels: readonly Readonly<{ key: "english" | "chinese"; label: string; options: readonly string[] }>[] = [
    { key: "english", label: "Английский", options: ADMISSIONS_DIRECT_ENGLISH },
    { key: "chinese", label: "Китайский", options: ADMISSIONS_DIRECT_CHINESE },
  ];
  return <>
    <Field label="Где учится сейчас" htmlFor={ids.educationCurrent} className={WIDE}>
      <select {...field("educationCurrent")} name="educationCurrent" className={FIELD_CLS}
        value={draft.educationCurrent} onChange={(e) => set("educationCurrent", e.target.value)}>
        <option value="">{ADMISSIONS_DIRECT_UNSPECIFIED}</option>
        {ADMISSIONS_DIRECT_EDUCATION_CURRENT.map((label) => <option key={label} value={label}>{label}</option>)}
      </select>
      {errorText("educationCurrent")}
    </Field>
    {levels.map(({ key, label, options }) => (
      <Field key={key} label={label} htmlFor={ids[key]}>
        <select {...field(key)} name={key} className={FIELD_CLS}
          value={draft[key]} onChange={(e) => set(key, e.target.value)}>
          <option value="">{ADMISSIONS_DIRECT_UNSPECIFIED}</option>
          {options.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
        {errorText(key)}
      </Field>
    ))}
  </>;
}

/** «Заметка»: что важно знать куратору. Продажник — в «Главном», в заметку он уходит первой строкой при сохранении. */
export function NoteFields({ form }: Readonly<{ form: AddStudentForm }>) {
  const { draft, ids, set, field, errorText } = form;
  return (
    <Field label="Что важно знать куратору" htmlFor={ids.note} className={WIDE}>
      <textarea {...field("note")} name="note" rows={3} maxLength={3500} className={`${FIELD_CLS} h-auto py-2`}
        value={draft.note} onChange={(e) => set("note", e.target.value)} />
      {errorText("note")}
    </Field>
  );
}
