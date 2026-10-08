import "server-only";

import type { ConfirmationEmailStatus } from "../account-deletion-contract.ts";

/**
 * Письмо «аккаунт удалён» (решение владельца 4: «если почта работает»). В
 * приложении нет своего почтового отправителя: Auth-почта Supabase шлёт только
 * свои шаблоны. Транспорт выбирается переменной окружения сервера:
 *  - `EVO_ACCOUNT_MAIL_TRANSPORT=resend`: Resend HTTP API
 *    (https://resend.com/docs/api-reference/emails/send-email: POST
 *    https://api.resend.com/emails, Bearer-ключ `RESEND_API_KEY`, поля from,
 *    to, subject, text; заголовок Idempotency-Key защищает повтор);
 *  - `EVO_ACCOUNT_MAIL_TRANSPORT=mailpit`: локальный Mailpit (POST
 *    /api/v1/send, поля From, To, Subject, Text), только адрес loopback;
 *  - не задано: письмо не отправляется, CRM пишет «почта не настроена».
 * Адрес не логируется; ошибка провайдера сводится к статусу.
 */

export type AccountDeletionMail = Readonly<{
  to: string;
  requestId: string;
  requestedAt: string | null;
}>;

type MailEnvironment = Readonly<Record<string, string | undefined>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DEFAULT_FROM = "EVO Admissions <no-reply@evoadmissions.com>";

function day(iso: string | null): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek" })
    .format(new Date(iso));
}

/**
 * Текст письма: русский, затем кыргызский. Ровно то, что сделано (дополнение
 * к 279 от 08.10): собственные записи аккаунта, проверенные вручную записи с
 * его телефоном или email, что хранится обезличенным, и что не меняется
 * (записи других людей, резервные копии). Без обещаний, которых нет.
 */
export function accountDeletionMailText(mail: AccountDeletionMail): Readonly<{ subject: string; text: string }> {
  const short = mail.requestId.replace(/-/gu, "").slice(0, 8);
  const date = day(mail.requestedAt);
  const ru = [
    "Здравствуйте.",
    "",
    date
      ? `Мы удалили ваш аккаунт EVO Admissions и ваши данные по вашему запросу от ${date}.`
      : "Мы удалили ваш аккаунт EVO Admissions и ваши данные по вашему запросу.",
    "Удалены вход в аккаунт, анкета, документы и файлы, сообщения в кабинете, ответы на тесты, уведомления, запросы консультаций и переписка WhatsApp, привязанная к вашей заявке.",
    "Другие записи с вашим телефоном или email сотрудник проверил вручную: те, что относятся к вам, удалены или обезличены.",
    "Если с вами был заключён договор, запись о нём и об оплатах хранится столько, сколько требует закон, без вашего имени, телефона, email и номеров документов.",
    "Записи других людей, где упомянуты ваш телефон или email, не менялись. Резервные копии базы этим действием не изменяются.",
    "",
    `Номер запроса: ${short}.`,
  ];
  const ky = [
    "Саламатсызбы.",
    "",
    date
      ? `Сиздин ${date} күнкү сурамыңыз боюнча EVO Admissions аккаунтуңузду жана маалыматтарыңызды өчүрдүк.`
      : "Сиздин сурамыңыз боюнча EVO Admissions аккаунтуңузду жана маалыматтарыңызды өчүрдүк.",
    "Аккаунтка кирүү, анкета, документтер жана файлдар, кабинеттеги билдирүүлөр, тесттердин жооптору, билдирмелер, консультация сурамдары жана арызыңызга байланышкан WhatsApp кат алышуусу өчүрүлдү.",
    "Телефонуңуз же email дарегиңиз бар башка жазууларды кызматкер кол менен текшерди: сизге тиешелүүлөрү өчүрүлдү же алардан атыңыз жана байланыштарыңыз алынып салынды.",
    "Эгер сиз менен келишим түзүлгөн болсо, келишим жана төлөмдөр жөнүндөгү жазуу мыйзам талап кылган мөөнөткө чейин сакталат, бирок атыңыз, телефонуңуз, email жана документтердин номерлери жок.",
    "Телефонуңуз же email дарегиңиз эскерилген башка адамдардын жазуулары өзгөртүлгөн жок. Маалымат базасынын камдык көчүрмөлөрү бул аракет менен өзгөрбөйт.",
    "",
    `Сурамдын номери: ${short}.`,
  ];
  return {
    subject: "EVO Admissions: аккаунт удалён / аккаунт өчүрүлдү",
    text: [...ru, "", "---", "", ...ky, ""].join("\n"),
  };
}

function loopbackUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") ? url : null;
  } catch {
    return null;
  }
}

export async function sendAccountDeletionMail(
  mail: Readonly<{ to: string | null; requestId: string; requestedAt: string | null }>,
  environment: MailEnvironment = process.env,
  fetcher: typeof fetch = fetch,
): Promise<ConfirmationEmailStatus> {
  if (!mail.to || !EMAIL.test(mail.to)) return "no_address";
  const transport = environment.EVO_ACCOUNT_MAIL_TRANSPORT;
  const { subject, text } = accountDeletionMailText({ to: mail.to, requestId: mail.requestId, requestedAt: mail.requestedAt });
  const from = environment.EVO_ACCOUNT_MAIL_FROM?.trim() || DEFAULT_FROM;
  try {
    if (transport === "resend") {
      const key = environment.RESEND_API_KEY;
      if (!key || !/^re_[A-Za-z0-9_]{8,}$/u.test(key)) return "not_configured";
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "idempotency-key": `account-deletion:${mail.requestId}`,
        },
        body: JSON.stringify({ from, to: [mail.to], subject, text }),
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok ? "sent" : "failed";
    }
    if (transport === "mailpit") {
      const base = loopbackUrl(environment.EVO_MAILPIT_URL);
      if (!base) return "not_configured";
      const address = /<([^>]+)>/u.exec(from)?.[1] ?? from;
      const response = await fetcher(new URL("/api/v1/send", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ From: { Email: address, Name: "EVO Admissions" }, To: [{ Email: mail.to }], Subject: subject, Text: text }),
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok ? "sent" : "failed";
    }
    return "not_configured";
  } catch {
    return "failed";
  }
}
