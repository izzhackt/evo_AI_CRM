import type { Metadata } from "next";
import { headers } from "next/headers";

import { LoginForm } from "@/components/AuthForms";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { EvoIsometricField } from "@/components/platform/brand/EvoIsometricField";
import { LangSwitcher } from "@/components/LangSwitcher";
import { getLocale } from "@/lib/i18n";
import { getPasswordRecoveryStrings } from "@/lib/portal/password-recovery-i18n";
import { STUDENT_PASSWORD_FORGOT_PATH } from "@/lib/student-password-recovery-contract";
import type { Locale } from "@/lib/i18n-data";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { ACCOUNT_DELETED_NOTICE } from "@/lib/account-deletion-contract";
import {
  platformAudienceForHost,
  PRODUCTION_STAFF_ORIGIN,
  PRODUCTION_STUDENT_ORIGIN,
  type PlatformAudience,
} from "@/lib/platform-public-origin";

const COPY: Record<
  Locale,
  Readonly<{
    accessDenied: string;
    accountDeleted: string;
    authUnavailable: string;
    staffAccessDenied: string;
    email: string;
    intro: string;
    password: string;
    signIn: string;
    title: string;
    panelTitle: string;
    panelText: string;
    panelNote: string | null;
    rememberDevice: string;
    rememberDeviceHint: string;
  }>
> = {
  ru: {
    accessDenied: "Не удалось войти. Проверьте оба значения.",
    accountDeleted: "Аккаунт удалён.",
    authUnavailable: "Сервис входа временно недоступен.",
    staffAccessDenied: "Аккаунт не имеет активного доступа к продукту EVO.",
    // 07.11.2026: входят и логином (кабинет от администратора), и почтой (регистрация на сайте).
    email: "Логин или почта",
    intro:
      "Для сотрудников и студентов EVO.",
    password: "Пароль",
    signIn: "Войти в CRM",
    title: "Вход в EVO",
    panelTitle: "EVO Admissions",
    panelText: "Поступление за рубеж: вузы, документы и связь с куратором в одном месте.",
    panelNote: "Китай · Малайзия · ОАЭ · Турция · Европа",
    rememberDevice: "Это моё устройство: не выходить каждый раз.",
    rememberDeviceHint: "На чужом или общем устройстве снимите галочку.",
  },
  ky: {
    accessDenied: "Кирүү ишке ашкан жок. Эки маанини тең текшериңиз.",
    accountDeleted: "Аккаунт өчүрүлдү.",
    authUnavailable: "Кирүү кызматы убактылуу жеткиликсиз.",
    staffAccessDenied: "Аккаунтта EVO продуктусуна активдүү мүмкүнчүлүк жок.",
    email: "Логин же почта",
    intro:
      "EVO кызматкерлери жана студенттери үчүн.",
    password: "Сырсөз",
    signIn: "CRMге кирүү",
    title: "EVO'го кирүү",
    panelTitle: "EVO Admissions",
    panelText: "Чет өлкөдө окууга тапшыруу: университеттер, документтер жана куратор менен байланыш бир жерде.",
    panelNote: "Кытай · Малайзия · БАЭ · Түркия · Европа",
    rememberDevice: "Бул менин түзмөгүм: ар жолу чыгып кетпейт.",
    rememberDeviceHint: "Бөтөн же жалпы түзмөктө белгини алып салыңыз.",
  },
  en: {
    accessDenied: "Access was not granted. Check both values.",
    accountDeleted: "Account deleted.",
    authUnavailable: "The sign-in service is temporarily unavailable.",
    staffAccessDenied: "This account has no active access to EVO.",
    email: "Login or email",
    intro:
      "For EVO staff and students.",
    password: "Password",
    signIn: "Sign in to CRM",
    title: "Sign in to EVO",
    panelTitle: "EVO Admissions",
    panelText: "Study abroad admissions: universities, documents and your curator in one place.",
    panelNote: "China · Malaysia · UAE · Türkiye · Europe",
    rememberDevice: "This is my device: keep me signed in.",
    rememberDeviceHint: "On a shared or someone else's device, untick it.",
  },
};

const AUDIENCE_COPY: Record<Locale, Record<PlatformAudience, Readonly<{
  title: string; intro: string; signIn: string; otherSignIn: string; panelTitle: string; panelText: string; panelNote: string | null;
}>>> = {
  ru: {
    staff: { title: "Вход для сотрудников", intro: "Рабочее пространство EVO.", signIn: "Войти в CRM", otherSignIn: "Кабинет студента",
      panelTitle: "EVO Admissions CRM", panelText: "Студенты, продажи, документы и переписка в одном месте.", panelNote: null },
    student: { title: "Кабинет студента", intro: "Ваше поступление и документы в EVO.", signIn: "Войти в кабинет", otherSignIn: "Вход для сотрудников",
      panelTitle: "Поступление за рубеж", panelText: "Вузы, документы, оплата и чат с куратором в одном кабинете.",
      panelNote: "Китай · Малайзия · ОАЭ · Турция · Европа" },
  },
  ky: {
    staff: { title: "Кызматкерлер үчүн кирүү", intro: "EVO иш мейкиндиги.", signIn: "CRMге кирүү", otherSignIn: "Студенттин кабинети",
      panelTitle: "EVO Admissions CRM", panelText: "Студенттер, сатуулар, документтер жана кат алышуу бир жерде.", panelNote: null },
    student: { title: "Студенттин кабинети", intro: "EVO'догу окууга тапшырууңуз жана документтериңиз.", signIn: "Кабинетке кирүү", otherSignIn: "Кызматкерлер үчүн кирүү",
      panelTitle: "Чет өлкөдө окуу", panelText: "Университеттер, документтер, төлөм жана куратор менен чат бир кабинетте.",
      panelNote: "Кытай · Малайзия · БАЭ · Түркия · Европа" },
  },
  en: {
    staff: { title: "Staff sign-in", intro: "Your EVO workspace.", signIn: "Sign in to CRM", otherSignIn: "Student portal",
      panelTitle: "EVO Admissions CRM", panelText: "Students, sales, documents and conversations in one place.", panelNote: null },
    student: { title: "Student portal", intro: "Your EVO admissions and documents.", signIn: "Sign in to portal", otherSignIn: "Staff sign-in",
      panelTitle: "Study abroad", panelText: "Universities, documents, payments and your curator chat in one portal.",
      panelNote: "China · Malaysia · UAE · Türkiye · Europe" },
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

type LoginPageSearchParams = Promise<{
  error?: string | string[];
  notice?: string | string[];
}>;

function firstQueryValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function LoginPage({
  searchParams,
}: Readonly<{ searchParams: LoginPageSearchParams }>) {
  // #1363: на входе только RU и KY; «en» из старого cookie показывается по-русски, как в кабинете и анкете.
  const locale: Locale = (await getLocale()) === "ky" ? "ky" : "ru";
  const audience = platformAudienceForHost((await headers()).get("host"));
  // 06.11.2026 (пользователь): форма как у студента — «Кабинет студента», «Войти в кабинет», внизу
  // «Вход для сотрудников». На неизвестном хосте (локально, предпросмотр) тоже студенческая, не общая.
  const audienceCopy = AUDIENCE_COPY[locale][audience ?? "student"];
  const copy = { ...COPY[locale], ...audienceCopy };
  const query = await searchParams;
  const error = firstQueryValue(query.error);
  // Удаление аккаунта (280, ревью п. 4): /auth/account-deleted вышел из
  // сессии удалённого аккаунта и сообщает об этом здесь.
  const accountDeleted = firstQueryValue(query.notice) === ACCOUNT_DELETED_NOTICE;
  const initialError =
    error === "session_invalid"
      ? "accessDenied"
      : error === "auth_unavailable"
        ? "authUnavailable"
        : error === "staffAccessDenied"
          ? "staffAccessDenied"
          : null;

  return (
    // 06.11.2026 (пользователь): на входе одна светлая тема без переключателя и два языка, RU и KY.
    <main data-theme="light" className="grid min-h-dvh bg-bg [color-scheme:light] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Тёмная панель бренда, как у образца (akylman.org.kg/login) и тёмной шапки «Главной» кабинета.
          На тёмном — только белый знак (вариант «inverted» из logobook). */}
      <div className="login-panel relative flex min-h-[400px] flex-col justify-between gap-10 overflow-hidden px-6 pb-10 pt-8 sm:px-10 lg:min-h-0 lg:px-12 lg:py-10">
        {/* Язык — тихо, в углу тёмной панели (просьба пользователя 06.11 «замаскируй»), только RU и KY. */}
        <div className="relative z-10 flex items-start justify-between gap-4">
          <EvoMark size={56} tone="inverted" />
          <div className="login-prefs flex items-center gap-1">
            <LangSwitcher current={locale} locales={["ru", "ky"]} />
          </div>
        </div>
        <div className="relative max-w-md">
          <p className="login-panel-title text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] lg:text-[44px]">
            {copy.panelTitle}
          </p>
          <p className="login-panel-text mt-4 text-[15px] leading-6 lg:text-base">{copy.panelText}</p>
          {copy.panelNote ? (
            <p className="login-panel-text mt-8 flex items-center gap-3 text-sm leading-5">
              <span aria-hidden="true" className="login-panel-dash" />
              {copy.panelNote}
            </p>
          ) : null}
        </div>
        {/* Крупный бледный знак справа, как буква у образца и знак в шапке «Главной» кабинета. */}
        <span aria-hidden="true" className="login-panel-watermark">
          <EvoMark size={340} tone="inverted" />
        </span>
      </div>

      <div className="relative flex flex-col overflow-hidden px-4 py-6 sm:px-6 lg:px-12">
        {/* Узор logobook (Pattern No. 1) в правом нижнем углу: для страницы входа он и сделан; под карточкой с текстом его не видно. */}
        <EvoIsometricField opacity={0.1} />
        <div className="flex flex-1 items-center justify-center py-8 sm:py-12">
        <div className="relative z-10 w-full max-w-[440px] rounded-card border border-border bg-surface p-6 sm:p-9">
          <h1 id="login-title" className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-fg-2">{copy.intro}</p>
          {accountDeleted && (
            <p role="status" className="mt-4 rounded-ctl border border-border bg-bg px-3 py-2 text-sm leading-6 text-fg">
              {copy.accountDeleted}
            </p>
          )}
          <div className="mt-6">
            <LoginForm
              labels={copy}
              initialError={initialError}
              recovery={audience === "staff" ? undefined : {
                href: STUDENT_PASSWORD_FORGOT_PATH,
                label: getPasswordRecoveryStrings(locale).forgotLink,
              }}
            />
          </div>
          {audience !== "staff" && <a href="/apply" className="mt-5 flex min-h-11 items-center justify-center rounded-ctl border border-control-edge px-4 text-sm font-semibold text-fg">{locale === "ky" ? "Студенттик аккаунт түзүү" : "Создать аккаунт студента"}</a>}
          <a
            href={`${audience === "staff" ? PRODUCTION_STUDENT_ORIGIN : PRODUCTION_STAFF_ORIGIN}/login`}
            className="mt-4 inline-flex min-h-11 items-center text-sm text-fg-2 underline-offset-4 hover:text-fg hover:underline focus-visible:underline"
          >
            {audienceCopy.otherSignIn}
          </a>
        </div>
        </div>
      </div>
    </main>
  );
}
