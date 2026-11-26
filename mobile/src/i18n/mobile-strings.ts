// Строки, которых нет в общих словарях веба (src/lib/portal/i18n.ts). Всё, что
// есть в вебе (навигация, профиль, пароль, восстановление), берётся оттуда.
// Тексты входа повторяют логин-страницу веба (src/app/login/page.tsx, COPY).
// KY: needs native proofreading, как и в вебе.
// Строки срезов лежат в `strings-*.ts`, по файлу на срез (таблица владельцев: docs/mobile/PLAN.md, «Волна 0 паритета»);
// здесь файлы только подключены: срез правит свой файл и не правит этот.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

import { INBOX_KY, INBOX_RU } from "@/i18n/strings-inbox";
import { LEARN_KY, LEARN_RU } from "@/i18n/strings-learning";
import { DOCS_KY, DOCS_RU } from "@/i18n/strings-documents";
import { PROFILE_KY, PROFILE_RU } from "@/i18n/strings-profile";
import { REGISTRATION_KY, REGISTRATION_RU } from "@/i18n/strings-registration";
import { APP_KY, APP_RU } from "@/i18n/strings-app";
import { CONSULTATION_KY, CONSULTATION_RU } from "@/i18n/strings-consultation";
import { HOME_KY, HOME_RU } from "@/i18n/strings-home";
import { LEARN2_KY, LEARN2_RU } from "@/i18n/strings-learning-2";
import { PAYMENTS_KY, PAYMENTS_RU } from "@/i18n/strings-payments";
import { PREPARATIONS_KY, PREPARATIONS_RU } from "@/i18n/strings-preparations";
import { SHELL_KY, SHELL_RU } from "@/i18n/strings-shell";
import { UNIVERSITIES_KY, UNIVERSITIES_RU } from "@/i18n/strings-universities";

const ru = {
  "auth.title": "Кабинет студента",
  "auth.intro": "Ваше поступление и документы в EVO.",
  "auth.login": "Логин или почта",
  "auth.password": "Пароль",
  "auth.signIn": "Войти в кабинет",
  "auth.signingIn": "Входим…",
  "auth.showPassword": "Показать пароль",
  "auth.hidePassword": "Скрыть пароль",
  "auth.accountDeleted": "Аккаунт удалён.",
  "auth.sessionExpired": "Сессия закончилась. Войдите снова.",
  "auth.err.invalid_credentials": "Не удалось войти. Проверьте оба значения.",
  "auth.err.staff_account": "Аккаунт не имеет активного доступа к продукту EVO.",
  "auth.err.rate_limited": "Слишком много попыток. Подождите несколько минут.",
  "auth.err.invalid_request": "Введите логин или почту и пароль.",
  "auth.err.unavailable": "Сервис входа временно недоступен.",
  "auth.err.network": "Нет связи. Проверьте интернет и повторите.",
  "setPassword.title": "Задайте свой пароль",
  "setPassword.intro": "Вы вошли с временным паролем. Придумайте свой, он будет нужен при следующих входах.",
  "setPassword.submit": "Сохранить пароль",
  "setPassword.saving": "Сохраняем…",
  "setPassword.unauthorized": "Сессия истекла. Войдите заново.",
  "gate.resolving": "Проверяем доступ…",
  "gate.offlineTitle": "Не удалось подключиться",
  "gate.serverTitle": "Сервис временно недоступен",
  "gate.retry": "Повторить",
  "gate.pendingTitle": "Доступ готовится",
  "gate.pendingBody": "Кабинет пока недоступен для этого аккаунта. Если вы ждёте доступа, напишите куратору EVO.",
  "gate.status.pending": "На рассмотрении",
  "gate.status.approved": "Одобрена, кабинет скоро откроется",
  "gate.status.rejected": "Требует исправления",
  "gate.refresh": "Обновить статус",
  "shell.menuClose": "Закрыть меню",
  "profile.theme": "Тема оформления",
  "profile.themeLight": "Светлая",
  "profile.themeDark": "Тёмная",
  "profile.themeSystem": "Как в системе",
  "profile.signingOut": "Выходим…",
  "error.offline": "Нет связи. Проверьте интернет и повторите.",
  "error.server": "Сервис временно недоступен. Повторите позже.",
  "error.forbidden": "Нет доступа к этому действию.",
  "error.conflict": "Данные изменились. Обновите экран и повторите.",
  "error.rateLimited": "Слишком много запросов. Подождите немного.",
  "error.generic": "Не удалось выполнить действие. Повторите.",
  "error.load": "Не удалось загрузить. Потяните вниз, чтобы обновить.",
  "state.loading": "Загрузка",
  "timeline.pathExpandedHint": "Нажмите, чтобы свернуть или раскрыть шаг",
  "timeline.openLink": "Открыть: {label}",
  "admission.countLabel": "{label}: {count}",
  "config.errorTitle": "Приложение не настроено",
  ...DOCS_RU,
  ...INBOX_RU,
  ...LEARN_RU,
  ...PROFILE_RU,
  ...REGISTRATION_RU,
  ...APP_RU,
  ...CONSULTATION_RU,
  ...HOME_RU,
  ...LEARN2_RU,
  ...PAYMENTS_RU,
  ...PREPARATIONS_RU,
  ...SHELL_RU,
  ...UNIVERSITIES_RU,
} as const;

export type MobileStringKey = keyof typeof ru;

const ky: Readonly<Record<MobileStringKey, string>> = {
  "auth.title": "Студенттин кабинети",
  "auth.intro": "EVO'догу окууга тапшырууңуз жана документтериңиз.",
  "auth.login": "Логин же почта",
  "auth.password": "Сырсөз",
  "auth.signIn": "Кабинетке кирүү",
  "auth.signingIn": "Кирип жатабыз…",
  "auth.showPassword": "Сырсөздү көрсөтүү",
  "auth.hidePassword": "Сырсөздү жашыруу",
  "auth.accountDeleted": "Аккаунт өчүрүлдү.",
  "auth.sessionExpired": "Сессия аяктады. Кайра кириңиз.", // KY: needs native proofreading
  "auth.err.invalid_credentials": "Кирүү ишке ашкан жок. Эки маанини тең текшериңиз.",
  "auth.err.staff_account": "Аккаунтта EVO продуктусуна активдүү мүмкүнчүлүк жок.",
  "auth.err.rate_limited": "Өтө көп аракет. Бир нече мүнөт күтүңүз.",
  "auth.err.invalid_request": "Логин же почтаны жана сырсөздү киргизиңиз.",
  "auth.err.unavailable": "Кирүү кызматы убактылуу жеткиликсиз.",
  "auth.err.network": "Байланыш жок. Интернетти текшерип, кайталаңыз.",
  "setPassword.title": "Өз сырсөзүңүздү коюңуз",
  "setPassword.intro": "Сиз убактылуу сырсөз менен кирдиңиз. Өзүңүздүкүн ойлоп табыңыз, кийинки кирүүлөрдө керек болот.",
  "setPassword.submit": "Сырсөздү сактоо",
  "setPassword.saving": "Сакталууда…",
  "setPassword.unauthorized": "Сессия аяктады. Кайра кириңиз.",
  "gate.resolving": "Мүмкүнчүлүк текшерилүүдө…",
  "gate.offlineTitle": "Туташуу мүмкүн болгон жок",
  "gate.serverTitle": "Кызмат убактылуу жеткиликсиз",
  "gate.retry": "Кайталоо",
  "gate.pendingTitle": "Мүмкүнчүлүк даярдалууда",
  "gate.pendingBody": "Бул аккаунт үчүн кабинет азырынча жеткиликсиз. Мүмкүнчүлүктү күтүп жатсаңыз, EVO куратору менен байланышыңыз.",
  "gate.status.pending": "Каралууда",
  "gate.status.approved": "Жактырылды, кабинет жакында ачылат",
  "gate.status.rejected": "Оңдоону талап кылат",
  "gate.refresh": "Абалды жаңыртуу",
  "shell.menuClose": "Менюну жабуу",
  "profile.theme": "Тема",
  "profile.themeLight": "Жарык",
  "profile.themeDark": "Караңгы",
  "profile.themeSystem": "Системадай",
  "profile.signingOut": "Чыгып жатабыз…",
  "error.offline": "Байланыш жок. Интернетти текшерип, кайталаңыз.",
  "error.server": "Кызмат убактылуу жеткиликсиз. Кийинчерээк кайталаңыз.",
  "error.forbidden": "Бул аракетке уруксат жок.",
  "error.conflict": "Маалыматтар өзгөрдү. Экранды жаңыртып, кайталаңыз.",
  "error.rateLimited": "Өтө көп суроо. Бир аз күтүңүз.",
  "error.generic": "Аракет аткарылган жок. Кайталаңыз.",
  "error.load": "Жүктөлгөн жок. Жаңыртуу үчүн төмөн тартыңыз.",
  "state.loading": "Жүктөлүүдө",
  "timeline.pathExpandedHint": "Кадамды жыйноо же ачуу үчүн басыңыз",
  "timeline.openLink": "Ачуу: {label}",
  "admission.countLabel": "{label}: {count}",
  "config.errorTitle": "Колдонмо ыңгайлаштырылган эмес",
  ...DOCS_KY,
  ...INBOX_KY,
  ...LEARN_KY,
  ...PROFILE_KY,
  ...REGISTRATION_KY,
  ...APP_KY,
  ...CONSULTATION_KY,
  ...HOME_KY,
  ...LEARN2_KY,
  ...PAYMENTS_KY,
  ...PREPARATIONS_KY,
  ...SHELL_KY,
  ...UNIVERSITIES_KY,
};

export const MOBILE_STRINGS = { ru, ky } as const;
