import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

import {
  documentReviewDecision,
  documentSlotStatus,
  paymentObligationCategory,
  paymentObligationStatus,
  studentOperationalStage,
} from "../src/lib/v3/wording.ts";
import { studentPortalNotificationReadRequestId } from "../src/lib/server/student-portal-notification-command-id.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import {
  homeDayMonth,
  homeDaysLabel,
  homeDaysUntil,
  homeTimeLabel,
  laterHomeDate,
  preparationHomeDates,
} from "../src/lib/portal/home-dates.ts";

// PORT-6a: строки экранов сопровождения живут в неймспейсе admission;
// структурные пины ниже проверяют ключи в TSX и русские значения в словаре.
const admissionRu = PORTAL_DICTIONARIES.admission.ru;

const ROOT = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function filesUnder(path) {
  const absolute = new URL(path, ROOT);
  return readdirSync(absolute)
    .flatMap((name) => {
      const directory = statSync(new URL(name, absolute)).isDirectory();
      return directory ? filesUnder(`${path}${name}/`) : [`${path}${name}`];
    })
    .sort();
}

test("the Student workspace preserves four portal pages, private tests and published universities", () => {
  const pageFiles = filesUnder("src/app/(portal)/portal/")
    .filter((path) => path.endsWith("/page.tsx") || path.endsWith("portal/page.tsx"));

  // applications/page.tsx stays on disk (unified workflow S5): the route is
  // kept connected only so old bookmarks/notification links still resolve,
  // and its file is now an unconditional redirect to /portal, not a page
  // with its own reader/view — see the "direct strict E2 result" test below.
  assert.deepEqual(pageFiles, [
    "src/app/(portal)/portal/applications/page.tsx",
    // S5.1 (миграции 285, 286): CSCA, предмет в пути оставляет место физике и химии.
    "src/app/(portal)/portal/csca/math/lesson/[lessonId]/page.tsx",
    "src/app/(portal)/portal/csca/math/progress/page.tsx",
    "src/app/(portal)/portal/csca/math/review/page.tsx",
    "src/app/(portal)/portal/csca/math/test/[formId]/page.tsx",
    "src/app/(portal)/portal/csca/page.tsx",
    "src/app/(portal)/portal/document-notifications/[notificationId]/page.tsx",
    "src/app/(portal)/portal/documents/page.tsx",
    "src/app/(portal)/portal/english/lesson/[lessonId]/page.tsx",
    "src/app/(portal)/portal/english/page.tsx",
    "src/app/(portal)/portal/english/review/page.tsx",
    "src/app/(portal)/portal/favorites/page.tsx",
    // PORT-9c: «Главная» — отдельный маршрут (корень /portal — смоук-якорь).
    "src/app/(portal)/portal/home/page.tsx",
    "src/app/(portal)/portal/messages/page.tsx",
    "src/app/(portal)/portal/notifications/[notificationId]/page.tsx",
    "src/app/(portal)/portal/notifications/page.tsx",
    // c47a8137c (#1000, 2026-09-21): package workflows add their own
    // notification deep-link and a standalone recovery entry point.
    "src/app/(portal)/portal/package-notifications/[notificationId]/page.tsx",
    "src/app/(portal)/portal/package-recovery/page.tsx",
    "src/app/(portal)/portal/page.tsx",
    "src/app/(portal)/portal/payments/page.tsx",
    "src/app/(portal)/portal/preparations/[applicationId]/page.tsx",
    // 356 (09.11.2026): экран «Конфиденциальность» при первом входе.
    "src/app/(portal)/portal/privacy/page.tsx",
    "src/app/(portal)/portal/professions/[cardId]/page.tsx",
    "src/app/(portal)/portal/professions/page.tsx",
    "src/app/(portal)/portal/profile/page.tsx",
    "src/app/(portal)/portal/tests/career/page.tsx",
    "src/app/(portal)/portal/tests/english/page.tsx",
    "src/app/(portal)/portal/tests/page.tsx",
    "src/app/(portal)/portal/universities/[id]/page.tsx",
    // S3 (план 7.3): страна и город каталога.
    "src/app/(portal)/portal/universities/country/[code]/[city]/page.tsx",
    "src/app/(portal)/portal/universities/country/[code]/page.tsx",
    "src/app/(portal)/portal/universities/page.tsx",
  ]);

  // PORT-2: the shell moved to src/components/portal/Shell.tsx (replace-don't-
  // layer, design contract docs/design/portal/design-contract.md). The section
  // list keeps exactly today's ten real routes (favorites — PORT-3b,
  // profile — PORT-5a, professions/english — PORT-4c); assisted-only sections
  // carry a tiers gate instead of disappearing from the source.
  const shell = source("src/components/portal/Shell.tsx");
  assert.deepEqual(
    [...shell.matchAll(/href: "([^"]+)"/gu)].map((match) => match[1]),
    [
      // #1355: «Главная» (/portal) — первый и единственный домашний пункт обоих tier'ов;
      // /portal/home перенаправляется на неё, пункта «Поступление» нет.
      "/portal",
      "/portal/documents",
      // 03.11.2026: «Оплата» снова пункт меню.
      "/portal/payments",
      // PORT-5c: переписка по делу — только assisted (tiers-гейт в Shell).
      "/portal/messages",
      // 03.11.2026: группы рейла «Выбор» и «Подготовка».
      "/portal/universities",
      "/portal/professions",
      // 03.11.2026: «Избранное» — вкладка «Вузы» на /portal, без пункта меню.
      "/portal/english",
      // S5.1: CSCA рядом с «Английским», навигация не перестраивается.
      "/portal/csca",
      // 03.11.2026: «Уведомления» вошли во «Входящие» (/portal/messages,
      // лента «Что нового»); сама страница осталась для старых ссылок.
      "/portal/tests",
      "/portal/profile",
    ],
  );
});

test("the portal uses the Student guard and never mounts the staff shell", () => {
  const layout = source("src/app/(portal)/layout.tsx");
  // PORT-2: the layout mounts the new portal Shell. PORT-1a (#869, 7da92e73a)
  // derives the access tier in the authority read itself; #928 (d1404aef1)
  // dropped the layout's duplicate ternary, so it just forwards actor.accessTier.
  const shell = source("src/components/portal/Shell.tsx");
  const authority = source("src/lib/supabase/student-portal-authority.ts");

  assert.match(layout, /requireStudentPortalActor\(\)/u);
  // 02.10: Shell получает тему запроса для кнопки «солнце/луна».
  assert.match(layout, /<Shell\s+displayName=\{actor\.displayName\}\s+accessTier=\{actor\.accessTier\}\s+locale=\{locale\}\s+theme=\{theme\}\s+release=\{[^}]*\}\s+studyCountry=\{studyCountry\}\s+railCollapsed=\{portalRailCollapsed\(cookieStore\.get\(PORTAL_RAIL_COOKIE\)\?\.value\)\}\s*>/u);
  // 03.11.2026: страна поступления для карточки внизу рейла — то же чтение 284,
  // сбой не роняет кабинет.
  assert.match(layout, /readStudentCountryChoice\(\)\.catch\(\(\): null => null\)/u);
  assert.match(authority, /accessTier: portalCase\.case_state === "pending" \? "approved" : "assisted"/u);
  // 03.11.2026: меню аккаунта в шапке убрано, «Выйти» — на «Профиле» (и с #1360 в меню телефона).
  // #1360 (09.11.2026): «Выйти» есть и внизу меню телефона, не только на «Профиле».
  assert.match(shell, /<form action=\{logoutStudentPortalAction\} className="pt-nav-logout">/u);
  assert.match(source("src/app/(portal)/portal/profile/page.tsx"), /logoutStudentPortalAction/u);
  assert.doesNotMatch(
    `${layout}\n${shell}`,
    /AppShell|requirePlatformStaffActor|role preview|presentationRole/u,
  );
});

test("Student render guard deduplicates only through React request-local cache", () => {
  const guard = source("src/lib/student-portal-guards.ts");
  assert.match(guard, /import \{ cache \} from "react"/u);
  assert.match(guard, /export const requireStudentPortalActor = cache\(async/u);
  assert.match(guard, /const result = await resolveStudentPortalActor\(\)/u);
  assert.match(guard, /result\.status === "authenticated"/u);
  assert.match(guard, /redirect\(studentPortalGuardDestination\(result\) \?\? "\/login"\)/u);
  assert.doesNotMatch(guard, /unstable_cache|use cache|new Map|setTimeout|setInterval/u);
  assert.doesNotMatch(source("src/lib/student-portal-auth.ts"), /\bcache\(/u);
});

test("the shell polls one light GET a minute and the page re-renders only when the section version changed", () => {
  // A4 (docs/PLAN_CHANGES.md 19.10.2026): раньше server action на 7-8 RPC раз в
  // минуту (план A); теперь GET с одним RPC. Расписание проверяет
  // tests/light-poll.test.mjs, здесь — что оболочка подключена именно так.
  const updates = source("src/components/portal/PortalNotificationUpdates.tsx");
  assert.match(updates, /createLightPoller\(/u);
  assert.match(updates, /fetchLightPoll\(url, signal\)/u);
  assert.match(updates, /portalPollUrl\(section\)/u);
  assert.match(updates, /else if \(section !== null\) startTransition\(\(\) => router\.refresh\(\)\)/u, "router.refresh only from onChange");
  assert.equal(updates.match(/startTransition\(\(\) => router\.refresh\(\)\)/gu)?.length, 1, "the page is re-rendered in exactly one place");
  assert.match(updates, /dispatchEvent\(new Event\(PORTAL_MESSAGES_CHANGED_EVENT\)\)/u);
  assert.match(updates, /noteServerRelease\(serverRelease\)/u, "a new release is recognised from the answer");
  assert.doesNotMatch(updates, /setInterval|loadStudentPortalNotificationState|student-portal-notification-updates/u);
  for (const event of ["visibilitychange", "focus", "online"]) {
    assert.ok(updates.includes(`addEventListener("${event}"`), event);
    assert.ok(updates.includes(`removeEventListener("${event}"`), event);
  }
  // The superseded server action (7-8 RPC per poll) is gone: replace, do not layer.
  assert.equal(existsSync(new URL("../src/lib/student-portal-notification-updates.ts", import.meta.url)), false);
});

test("Student preview implementation and staff entry are retired without removing the real portal", () => {
  for (const path of [
    "src/app/(portal-preview)/layout.tsx",
    "src/app/(portal-preview)/preview/student/[[...section]]/page.tsx",
    "src/app/(portal-preview)/preview/student/[[...section]]/loading.tsx",
    "src/app/(portal-preview)/preview/student/[[...section]]/error.tsx",
    "src/lib/server/student-portal-preview.ts",
    "src/lib/server/student-portal-assessment-preview.ts",
    "src/lib/server/student-portal-assessment-preview-content.ts",
    "src/components/staff/portal/assessments/AssessmentPreviewPage.tsx",
    "src/components/staff/portal/assessments/AssessmentPreviewRunner.tsx",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  const staffShell = source("src/components/staff/AppShell.tsx");
  assert.doesNotMatch(staffShell, /student-portal-preview|\/preview\/student|Предпросмотр кабинета студента/u);
  assert.match(staffShell, /selectStaffRolePreviewAction/u);
  for (const path of [
    // PORT-2: the live shell lives in src/components/portal/Shell.tsx now.
    "src/components/portal/Shell.tsx",
    // PORT-5d: «Моё поступление» живёт в Атласе.
    "src/components/portal/admission/OverviewView.tsx",
  ]) assert.doesNotMatch(source(path), /preview/u, path);
  for (const path of [
    "src/app/(portal)/portal/tests/english/page.tsx",
    "src/app/(portal)/portal/tests/career/page.tsx",
    "supabase/assessment-content/english-v1.json",
    "supabase/assessment-content/orvis-v1.json",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
});

test("every page passes the direct strict E2 result to its view", () => {
  const expected = [
    ["src/app/(portal)/portal/documents/page.tsx", "readStudentPortalDocuments", "documents", "DocumentsView"],
  ];

  for (const [path, reader, resultName, component] of expected) {
    const page = source(path);
    assert.match(
      page,
      new RegExp(`import \\{ ${reader} \\} from "@/lib/v3/portal-source"`, "u"),
    );
    // PORT-6a: страницы дополнительно читают locale (тем же Promise.all) и
    // передают его view — RU/KY словарь admission резолвится на сервере.
    // «Главная» (/portal, бывший обзор «Моего поступления», #1355) читает обзор сама: проверяется в тесте «Главной».
    assert.match(page, new RegExp(`const \\[${resultName}, locale\\] = await Promise\\.all\\(\\[${reader}\\(\\), getLocale\\(\\)\\]\\)`, "u"));
    assert.match(page, new RegExp(`<${component}[\\s\\S]*locale=\\{locale\\}`, "u"));
    assert.match(
      page,
      new RegExp(`<${component}[\\s\\S]*${resultName}=\\{${resultName}\\}`, "u"),
    );
    assert.doesNotMatch(page, /createClient|supabase|sqlite|drizzle|fixture|demo/iu);
  }
});

test("«Оплата» reads the whole payment center once (миграция 358) and hands it to its view", () => {
  const page = source("src/app/(portal)/portal/payments/page.tsx");
  assert.match(page, /import \{ readPaymentCenter \} from "@\/lib\/portal\/payment-center-source"/u);
  assert.match(page, /const \[center, locale\] = await Promise\.all\(\[readPaymentCenter\(\), getLocale\(\)\]\)/u);
  assert.match(page, /<PaymentsView[\s\S]*center=\{center\}[\s\S]*locale=\{locale\}/u);
  assert.doesNotMatch(page, /createClient|supabase|sqlite|drizzle|fixture|demo/iu);
});

test("the home screen continues real work, keeps the smoke root and omits invented recency", () => {
  // #1355: «Главная» — единственная домашняя страница /portal; /portal/home только перенаправляет на неё.
  const page = source("src/app/(portal)/portal/page.tsx");
  // 08.11.2026: «Что сделать сейчас» и «Мои вузы» вынесены из HomeView в свои файлы; проверяем вид целиком.
  const view = ["HomeView", "HomeCase"]
    .map((name) => source(`src/components/portal/home/${name}.tsx`))
    .join("\n");
  const homeRu = PORTAL_DICTIONARIES.home.ru;

  assert.match(page, /requireStudentPortalActor\(\)/u);
  // PORT-1a: граница уровня доступа — серверный accessTier authority, не
  // повторная scattered-деривация из caseState (review #907, finding A).
  assert.match(page, /const tier = actor\.accessTier;/u);
  // Заявка на рассмотрении — только флаг для блока заявки (OverviewView), не граница доступа.
  assert.doesNotMatch(page, /caseState !== "pending"|tier = .*caseState/u);

  // Серверные read model изолируют транспорт; view не обращается к БД напрямую.
  for (const reader of [
    "readStudentPortalOverview",
    "readStudentUniversityFavorites",
    "readStudentUniversitiesByIds",
    "readStudentCatalogPreparations",
    "readStudentPortalNotifications",
  ]) assert.match(page, new RegExp(`\\b${reader}\\b`, "u"), reader);
  assert.doesNotMatch(page, /\.rpc\(|\.schema\(|createClient|supabase|sqlite|drizzle|fixture|demo/iu);
  assert.doesNotMatch(view, /\.rpc\(|\.schema\(|createClient|supabase|useEffect|fixture|demo/iu);

  // Обзор дела читается только для assisted; каждый источник несёт свой
  // честный fallback (catch -> null/failed), не роняя весь экран.
  assert.match(page, /tier === "assisted"\s*\?\s*readStudentPortalOverview\(\)/u);
  // 03.11.2026: «Учёба и тесты» и «Новое в каталоге» сняты с «Главной»
  // (слово пользователя); их чтений на странице нет, «Что нового» — только assisted.
  assert.doesNotMatch(page, /readLearningModules|readStudentAssessments|readStudentRecentUniversities/u);
  assert.match(page, /tier === "assisted" \? readStudentPortalNotifications\(\)\.catch\(\(\): null => null\) : Promise\.resolve\(null\)/u);
  assert.match(view, /overviewFailed/u);
  assert.equal(homeRu.caseUnavailable, "Не удалось загрузить, что нужно сделать. Обновите страницу.");

  assert.doesNotMatch(view, /готовност|processed|percent/iu);

  // Избранное — даты ближайшего набора в «Ближайших датах» (только open/announced внутри helper'а); сами вузы —
  // в «Моём списке» под колонками.
  assert.match(view, /nearestUniversityIntake/u);
  assert.match(view, /\/portal\/universities\/\$\{item\.id\}/u);
  assert.match(page, /<FavoritesSection institutionIds=/u);
  assert.match(page, /<HomeFavorites/u);

  // Assisted: та же модель действий, что у OverviewView «Моего поступления».
  assert.match(view, /overview\?\.studentAction/u);
  assert.match(view, /\/portal\/documents#document-\$\{action\.documentSlotId\}/u);
  // Ссылки на разделы, которые есть в меню, с карточки дела сняты; «Ещё
  // действий» ведёт в «Документы» (#1355: «Моего поступления» больше нет).
  assert.match(view, /href="\/portal\/documents" className="pt-link pt-home-case-more"/u);
  assert.doesNotMatch(view, /pt-home-case-links/u);

  // «Новое в каталоге» (новизна по первой публикации, 207) с «Главной» снято.
  assert.doesNotMatch(view, /item\.publishedAt|firstPublishedAt/u);

  // Смоук-якоря корня (#1355): /portal — «Главная» с заголовком карточки «Что сделать сейчас».
  assert.match(page, /<HomeView/u);
  assert.equal(PORTAL_DICTIONARIES.home.ru.caseHeading, "Что сделать сейчас");
  assert.equal(PORTAL_DICTIONARIES.home.ru.title, "Главная");
  assert.match(source("src/app/(portal)/portal/home/page.tsx"), /redirect\("\/portal"\);/u);

  // «Главная» подключена за прокси (урок hotfix'а release-3).
  const routeContract = source("src/lib/platform-route-contract.ts");
  assert.match(routeContract, /"\/portal\/home",/u);
});

test("the home lifts «Мой список» next to the case and keeps the explanation behind «?»", () => {
  // 18.11.2026: главная казалась скучной — список вузов поднят рядом с делом, блоки входят по очереди.
  const page = source("src/app/(portal)/portal/page.tsx");
  const view = source("src/components/portal/home/HomeView.tsx");
  const homeCase = source("src/components/portal/home/HomeCase.tsx");
  const favorites = source("src/components/portal/home/HomeFavorites.tsx");
  const css = source("src/app/(portal)/portal.css");

  // Список — в левой колонке, когда справа есть путь; без страны и «Всё избранное» — во всю ширину под колонками.
  assert.match(view, /const listInColumn = list !== null && path !== null && \(tier === "assisted" \|\| csca !== null\);/u);
  const main = view.indexOf('<div className="pt-home-main">');
  const listSlot = view.indexOf('data-slot="list"');
  const side = view.indexOf('<div className="pt-home-side">');
  assert.ok(main > 0 && listSlot > main && side > listSlot, "the list slot sits in the left column");
  assert.match(view, /\{listInColumn \? null : list\}\n\s+\{wideList\}/u);
  assert.match(page, /const allFavoritesView = view === "universities" && allFavorites;/u);
  assert.match(page, /list=\{allFavoritesView \? null : list\}\n\s+wideList=\{allFavoritesView \? list : null\}/u);
  assert.match(page, /boxed=\{!allFavoritesView\}/u);
  // Из «Всего избранного» вкладка возвращает список в колонку: переход докручивает к #list; между вкладками — на месте.
  const list = source("src/components/portal/home/HomeList.tsx");
  assert.match(list, /const scroll = boxed \? false : undefined;/u);
  assert.equal(list.match(/scroll=\{scroll\}/gu)?.length, 2);
  // Полувидную карточку ленты фокус с клавиатуры докручивает в кадр.
  assert.match(source("src/components/portal/home/HomeFavoritesStrip.tsx"), /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/u);
  // В одну колонку путь стоит раньше списка (08.11.2026: путь не уезжает за вузы).
  assert.match(css, /\.pt-home-slot\[data-slot="list"\] \{ order: 3; \}/u);
  assert.doesNotMatch(css, /data-slot="path"/u, "18.11.2026: path card removed; the whole path stands under the header");
  // Под фото вуза — ближайший срок тем же текстом, что у каталога; без открытого набора строки нет.
  assert.match(favorites, /const intake = nearest \? intakeText\(nearest, universityStrings, locale\) : null;/u);
  assert.match(favorites, /\{intake \? <span className="pt-home-fav-intake">\{intake\}<\/span> : null\}/u);

  // Дело: кнопка одна, следующие два дела строками. Образец документа пробовали и сняли (18.11.2026).
  assert.doesNotMatch(homeCase, /documentGuideView|DocumentSampleFigure|pt-home-case-sample/u);
  assert.equal(homeCase.match(/className="pt-btn"/gu)?.length, 1, "one red button: the first case");
  assert.match(homeCase, /const HOME_CASE_ROWS = 3;/u);
  assert.match(homeCase, /overview\.studentActions\.slice\(1, HOME_CASE_ROWS\)/u);
  // Значок по виду дела и срок словом в пилюле статуса кабинета: просрочено — «опасно», сегодня и завтра — «внимание».
  assert.match(homeCase, /<HomeIcon name=\{primary\.kind === "payment" \? "payments" : "documents"\} \/>/u);
  assert.match(homeCase, /tone=\{days < 0 \? "danger" : days <= 1 \? "warn" : "neutral"\}/u);
  assert.match(homeCase, /homeDaysUntil\(bishkekDay\(dueAt\), today\)/u);
  // Срок, прошедший сегодня по часам, — «просрочено», как у сервера и «Оплаты».
  assert.match(homeCase, /if \(days >= 0 && passed\) return <PortalStatus label=\{strings\.dateOverdueNow\} tone="danger" \/>;/u);
  assert.equal(PORTAL_DICTIONARIES.home.ru.dateOverdueNow, PORTAL_DICTIONARIES.admission.ru["payStatus.overdue"]);
  assert.equal(PORTAL_DICTIONARIES.home.ky.dateOverdueNow, PORTAL_DICTIONARIES.admission.ky["payStatus.overdue"]);
  assert.match(homeCase, /count=\{failed \? null : overview\?\.studentActions\.length \?\? null\}/u);
  assert.match(view, /<HomeCase overview=\{overview\} failed=\{overviewFailed\} today=\{today\} now=\{now\} locale=\{locale\} \/>/u);
  // «?» и переходы шапки карточки не уходят на вторую строку: переносится текст заголовка.
  assert.match(source("src/app/(portal)/portal.css"), /\.pt-home-head > \.pt-home-heading \{\n {2}flex: 0 1 auto;\n {2}min-width: 0;\n\}/u);
  // Пояснение «откуда действия» — за «?» в шапке, строкой внизу его больше нет.
  assert.match(homeCase, /<HomeHint label=\{strings\.caseHint\} text=\{strings\.caseFoot\} \/>/u);
  assert.doesNotMatch(homeCase, /pt-home-foot/u);
  assert.equal(PORTAL_DICTIONARIES.home.ru.caseHint, "Откуда эти действия");
  // «Ближайшие даты» (по образцу Акылмана): плитка «число и месяц», полная дата для читалки, сколько осталось.
  const dates = source("src/components/portal/home/HomeDates.tsx");
  assert.match(dates, /<time dateTime=\{item\.day\} className="pt-home-date-tile">/u);
  assert.match(dates, /<span className="pt-sr-only">\{universityDateLabel\(item\.day, locale\)\}<\/span>/u);
  assert.match(dates, /homeDaysLabel\(homeDaysUntil\(item\.day, today\), locale, strings\)/u);
  assert.equal(homeDaysUntil("2026-09-20", "2026-09-20"), 0);
  assert.equal(homeDaysUntil("2026-10-01", "2026-09-20"), 11);
  assert.equal(homeDaysUntil("2027-01-01", "2026-12-31"), 1);
  const ru = PORTAL_DICTIONARIES.home.ru;
  assert.equal(homeDaysLabel(0, "ru", ru), "сегодня");
  assert.equal(homeDaysLabel(1, "ru", ru), "завтра");
  assert.equal(homeDaysLabel(21, "ru", ru), "через 21 день");
  assert.equal(homeDaysLabel(3, "ru", ru), "через 3 дня");
  assert.equal(homeDaysLabel(11, "ru", ru), "через 11 дней");
  assert.equal(homeDaysLabel(-1, "ru", ru), "просрочено на 1 день");
  assert.equal(homeDaysLabel(-3, "ru", ru), "просрочено на 3 дня");
  assert.equal(homeDaysLabel(-5, "ky", PORTAL_DICTIONARIES.home.ky), "мөөнөтү 5 күн өттү");
  for (const locale of ["ru", "ky"]) {
    for (const key of ["dateToday", "dateTomorrow", "dateIn.one", "dateIn.few", "dateIn.many", "dateOverdue.one", "dateOverdue.few", "dateOverdue.many"]) {
      assert.ok(PORTAL_DICTIONARIES.home[locale][key], `${locale} ${key}`);
    }
  }
  assert.equal(PORTAL_DICTIONARIES.home.ru["dateIn.few"], "через {count} дня");

  // Шапка (18.11.2026, выбор пользователя): набор рядом со страной и отсчёт до ближайшей даты; куратора в шапке нет.
  const hero = source("src/components/portal/home/HomeHero.tsx");
  assert.equal(hero.match(/<h1 /gu)?.length, 1, "one h1: the greeting");
  assert.doesNotMatch(hero, /curator|accountInitials/u);
  assert.match(view, /const nearest = upcomingHomeDates\(dated, today\)\[0\] \?\? null;/u);
  assert.match(page, /intake=\{journey\.view\?\.intake\.label \?\? null\}/u);
  assert.match(hero, /className="pt-home-hero-count"/u);
  // 19.11.2026: просроченное дело важнее ближайшей даты — шапка говорит «Просрочено» красной плашкой со словом.
  assert.match(view, /const countdown = overdue\?\.dueAt\n\s+\? \{[^}]*overdue: true \}\n\s+: nearest/u);
  assert.match(view, /Date\.parse\(action\.dueAt\) < now\.getTime\(\)/u, "passed today by the clock is overdue, as in the case card");
  assert.match(hero, /if \(countdown\.overdue\) return \{ big: strings\.heroOverdue, word: null \};/u);
  assert.match(hero, /data-overdue=\{countdown\.overdue \? "" : undefined\}/u);
  assert.equal(PORTAL_DICTIONARIES.home.ru.heroOverdue, "Просрочено");
  assert.ok(PORTAL_DICTIONARIES.home.ky.heroOverdue.length > 0);
  assert.doesNotMatch(source("src/app/(portal)/portal.css").slice(
    source("src/app/(portal)/portal.css").indexOf("/*\n * Отсчёт до ближайшей даты"),
    source("src/app/(portal)/portal.css").indexOf("/* Узкая шапка: отсчёт строкой"),
  ), /var\(--pt-(?:accent|error|danger)|#[0-9a-f]{3,8}\b/iu, "hero additions use hero tokens only, no red text");
  assert.ok(PORTAL_DICTIONARIES.home.ky.caseHint.length > 0);
});

test("the home dates add own programmes and the first later date; news and the application read in words", () => {
  // 18.11.2026: четыре дополнения «Главной» без новых данных и схемы.
  const ru = PORTAL_DICTIONARIES.home.ru;
  const today = "2026-09-20";
  const intake = (patch = {}) => ({ id: "i1", label: "Сентябрь 2027", startDate: "2027-09-01", startMonth: "2027-09", applicationDeadline: "2026-10-05", deadlineTime: null, timezone: null, status: "open", note: "", sourceUrl: "https://example.edu", verifiedOn: "2026-09-01", ...patch });
  const prep = (patch = {}, intakePatch = {}) => ({
    applicationId: "a1", institutionId: "u1", programId: "p1", intakeId: "i1", deadlineStateAtSelection: "confirmed", applicationStatus: "preparation",
    content: { name: "Wuhan University", programs: [{ id: "p1", title: "Computer Science", intakes: [intake(intakePatch)] }] },
    ...patch,
  });
  // Срок своей программы: подача, без неё — старт; ссылка на программу; вуз для снятия общей строки избранного.
  assert.deepEqual(preparationHomeDates([prep()], today, ru), [
    { day: "2026-10-05", title: "Computer Science, Wuhan University: последний день подачи", href: "/portal/preparations/a1", institutionId: "u1" },
  ]);
  assert.equal(preparationHomeDates([prep({}, { applicationDeadline: null })], today, ru)[0].title, "Computer Science, Wuhan University: начало учёбы");
  assert.equal(preparationHomeDates([prep({}, { applicationDeadline: "2026-09-01" })], today, ru)[0].day, "2027-09-01", "a passed deadline falls back to the start");
  // Заявка подана, срок «уточнить с куратором», набор закрыт — строки нет.
  for (const [patch, intakePatch] of [[{ applicationStatus: "submitted" }, {}], [{ deadlineStateAtSelection: "needs_confirmation" }, {}], [{}, { status: "closed" }], [{ intakeId: "other" }, {}]]) {
    assert.deepEqual(preparationHomeDates([prep(patch, intakePatch)], today, ru), [], JSON.stringify([patch, intakePatch]));
  }
  const view = source("src/components/portal/home/HomeView.tsx");
  assert.match(view, /if \(programInstitutions\.has\(item\.id\)\) return \[\];/u, "a favourite with an own programme does not repeat it");
  assert.match(source("src/app/(portal)/portal/page.tsx"), /preparations=\{preparations\}/u);

  // «Дальше»: первая дата позже окна в 60 дней, только когда в окне пусто.
  const later = laterHomeDate([{ day: "2027-05-31", title: "UM", href: "/u" }, { day: "2027-03-01", title: "X", href: "/x" }, { day: "2026-10-01", title: "near", href: "/n" }], today);
  assert.equal(later?.day, "2027-03-01");
  assert.equal(laterHomeDate([{ day: "2026-10-01", title: "near", href: "/n" }], today), null);
  assert.match(source("src/components/portal/home/HomeDates.tsx"), /const later = upcoming\.length === 0 \? laterHomeDate\(items, today\) : null;/u);

  // Время события словом по Бишкеку; число рядом с месяцем — в родительном падеже.
  const now = new Date("2026-09-20T12:00:00Z");
  assert.equal(homeTimeLabel("2026-09-20T08:00:00Z", now, "ru", ru), "сегодня, 14:00");
  assert.equal(homeTimeLabel("2026-09-19T10:30:00Z", now, "ru", ru), "вчера, 16:30");
  assert.equal(homeTimeLabel("2026-09-17T10:30:00Z", now, "ru", ru), "3 дня назад");
  assert.equal(homeTimeLabel("2026-09-01T10:30:00Z", now, "ru", ru), "1 сент.");
  assert.equal(homeTimeLabel("2025-05-31T10:30:00Z", now, "ru", ru), "31 мая 2025");
  assert.equal(homeTimeLabel("not a date", now, "ru", ru), null);
  assert.equal(homeDayMonth("2027-05-31", "ru"), "31 мая");
  const news = source("src/components/portal/home/HomeNews.tsx");
  assert.match(news, /<HomeIcon name=\{KIND_ICON\[portalNotificationKind\(item\)\]\} \/>/u);
  assert.match(news, /<time dateTime=\{item\.createdAt\} title=\{created \?\? undefined\}/u);


  // «Ваша анкета» до договора: отметки с датами из своей анкеты; чтение — только у approved, сбой — прежняя карточка.
  const page = source("src/app/(portal)/portal/page.tsx");
  assert.match(page, /tier === "approved" \? readOwnStudentApplication\(\)\.catch\(\(\): null => null\) : Promise\.resolve\(null\)/u);
  assert.match(view, /\{strings\.applicationSent\}/u);
  assert.match(view, /application\?\.status === "approved" && application\.decidedAt/u);
  for (const locale of ["ru", "ky"]) {
    for (const key of ["dateProgramDeadline", "dateProgramStart", "datesLater", "timeToday", "timeYesterday", "timeDaysAgo.one", "timeDaysAgo.few", "timeDaysAgo.many", "applicationSent", "applicationApproved"]) {
      assert.ok(PORTAL_DICTIONARIES.home[locale][key], `${locale} ${key}`);
    }
  }
});

test("the path header on «Главная» stands on a real photo of the capital, with credit, only for its own country", async (t) => {
  // 18.11.2026: фото столицы — фон компактной шапки пути; нет фото столицы (ОАЭ) — фото страны; нет и его — без фото.
  // Адрес фото собирается из публичного адреса Supabase: на время теста — выдуманные значения, потом прежние.
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_home-photo-test";
  t.after(() => {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
  });
  const { capitalPhoto } = await import("../src/lib/portal/university-tiles.ts");
  const geo = (path) => ({ path, width: 2000, height: 1200, author: "A", authorUrl: null, sourceName: "Pexels", sourceUrl: "https://www.pexels.com/photo/x/", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" });
  const index = {
    version: "1",
    universities: [],
    countries: [
      { code: "CN", name: { ru: "Китай", ky: "Кытай" }, photo: geo("geography/countries/cn-f1bef3115cf5.jpg"), summary: null, universityCount: 1, cityCount: 2 },
      { code: "AE", name: { ru: "ОАЭ", ky: "БАЭ" }, photo: geo("geography/countries/ae-1ca7d146ccef.jpg"), summary: null, universityCount: 1, cityCount: 1 },
      { code: "IT", name: { ru: "Италия", ky: "Италия" }, photo: null, summary: null, universityCount: 0, cityCount: 0 },
    ],
    cities: [
      { key: "shanghai", country: "CN", photo: geo("geography/cities/cn-shanghai-41b1eb070bbd.jpg") },
      { key: "beijing", country: "CN", photo: geo("geography/cities/cn-beijing-7288cd4b2583.jpg") },
      { key: "dubai", country: "AE", photo: geo("geography/cities/ae-dubai-291c279a2408.jpg") },
    ],
  };
  assert.match(capitalPhoto(index, "CN")?.src ?? "", /geography\/cities\/cn-beijing-7288cd4b2583\.jpg$/u);
  assert.equal(capitalPhoto(index, "CN")?.credit.author, "A");
  assert.match(capitalPhoto(index, "AE")?.src ?? "", /geography\/countries\/ae-1ca7d146ccef\.jpg$/u, "no Abu Dhabi: the country photo");
  assert.equal(capitalPhoto(index, "IT"), null);

  const page = source("src/app/(portal)/portal/page.tsx");
  assert.match(page, /readStudentUniversityIndex\(actor\)\n\s+\.then\(\(index\) => \(\{ country, image: capitalPhoto\(index, country\) \}\)\)\n\s+\.catch\(\(\): null => null\)/u);
  assert.match(page, /photo: capital\?\.image \? \{ country: capital\.country, image: capital\.image \} : null,/u);
  const block = source("src/components/portal/home/CountryTimeline.tsx");
  assert.match(block, /const headPhoto = view && photo && photo\.country === view\.choice \? photo\.image : null;/u);
  assert.match(block, /<PhotoRights credit=\{headPhoto\.credit\} strings=\{photoStrings\} placement="top" \/>/u);
  // Белый текст на фото — на тёмной подложке; значения те же, что у мест каталога, объявлены в одном месте.
  const css = source("src/app/(portal)/portal.css");
  assert.match(css, /\.pt-atlas,\n\.pt-journey-head\[data-photo\] \{/u);
  assert.match(css, /\.pt-journey-photo::after \{[^}]*rgb\(20 16 12 \/ 0\.86\) 0, rgb\(20 16 12 \/ 0\.74\) 600px/u);
});

test("the retired applications route is an unconditional redirect, not a view", () => {
  const page = source("src/app/(portal)/portal/applications/page.tsx");
  assert.match(page, /import \{ redirect \} from "next\/navigation"/u);
  assert.match(page, /redirect\("\/portal"\)/u);
  assert.doesNotMatch(
    page,
    /readStudentPortal|ApplicationsView|createClient|supabase|sqlite|drizzle|fixture|demo/iu,
  );
});

test("overview names each actor from the canonical projection and links exact items", () => {
  // PORT-5d: «Моё поступление» живёт в Атласе (portal/admission).
  const overview = source("src/components/portal/admission/OverviewView.tsx");
  const documents = source("src/components/portal/admission/DocumentsView.tsx");
  // 08.11.2026: плитки «Требуют действия» нет; первое дело открывает «Что сделать сейчас» на «Главной».
  const homeCase = source("src/components/portal/home/HomeCase.tsx");

  assert.match(homeCase, /overview\?\.studentAction/u);
  assert.match(overview, /overview\?\.evoAction/u);
  assert.doesNotMatch(overview, /overview\.nextAction/u);
  // PORT-6a: строки — ключи admission-словаря (проверяется по словарю, не по TSX).
  // Разгрузка кабинета 03.11.2026: подпись под заголовком шага и пояснения
  // героя убраны — заголовок и кнопка говорят то же самое.
  assert.doesNotMatch(overview, /nextStepNote|heroUploadLead|heroDocumentTerm/u);
  assert.match(overview, /strings\.evoHeading/u);
  assert.equal(admissionRu.evoHeading, "Что делает EVO");
  assert.match(
    homeCase,
    /\/portal\/documents#document-\$\{action\.documentSlotId\}/u,
  );
  // Overview is a flat action queue now: no nested <details> disclosure.
  assert.doesNotMatch(overview, /<details/u);
  assert.match(overview, /id=\{`evo-task-\$\{evoAction\.taskId\}`\}/u);
  // Без задачи команды блока «Что делает EVO» нет вовсе — пустую строку-заглушку
  // студент не читает; спокойное состояние — один заголовок без пояснения.
  assert.match(overview, /if \(!\(evoAction && evoStatus\)\) return null;/u);
  assert.match(overview, /<div id=\{`evo-task-\$\{evoAction\.taskId\}`\} className="pt-adm-info-card">\s*<h2 className="pt-adm-aside-title">\{strings\.evoHeading\}<\/h2>/u);
  assert.doesNotMatch(overview, /evoEmpty|calmDoneLead/u);
  assert.equal(admissionRu.calmDone, "Сейчас действий от вас не требуется");
  // PORT-5d: 44px-цели живут в pt-классах (portal.css), не в tailwind-утилитах.
  // 03.11.2026: карточки «Ваш следующий шаг» нет. 08.11.2026 (пользователь:
  // «вот это можно убрать а те 2 на один этаж поставить»): плитки «Требуют
  // действия» тоже нет, на «Поступлении» две плитки в один ряд.
  assert.doesNotMatch(overview, /student-next-step|pt-adm-hero/u);
  assert.doesNotMatch(overview, /tile\.actions|studentAction\b|actionHref/u);
  assert.equal(admissionRu["tile.actions"], undefined);
  assert.match(
    documents,
    /id=\{`document-\$\{document\.documentSlotId\}`\}/u,
  );
});

test("the overview never claims a mandatory stage, and a pending cabinet stays honest", () => {
  const overview = source("src/components/portal/admission/OverviewView.tsx");
  const presentation = source("src/components/portal/admission/presentation.ts");
  const wording = source("src/lib/v3/wording.ts");
  const portalPage = source("src/app/(portal)/portal/page.tsx");
  const applyStatusPage = source("src/app/apply/status/page.tsx");

  // Plan §10/S5: no invented mandatory stage pill, and no leftover helper.
  assert.doesNotMatch(overview, /Текущий этап/u);
  assert.doesNotMatch(overview, /overviewStage/u);
  assert.doesNotMatch(presentation, /export function overviewStage/u);

  // PORT-8c: операционный этап из read model рендерится честно — известные
  // ключи через admission.stage.* (RU байт-в-байт зеркалит staff-словарь
  // studentOperationalStage), нестандартное значение — stageCustom, без
  // overview этапа нет вовсе. Никакого нового RPC и выдуманных названий.
  // 03.11.2026: «Моё поступление» больше не рисует этап; подпись этапа живёт
  // в «Профиле» той же функцией stageLabel.
  assert.match(overview, /strings\.stageCustom/u);
  assert.match(source("src/app/(portal)/portal/profile/page.tsx"),
    /const stage = overview \? stageLabel\(overview\.operationalStage, admissionStrings\) : null/u);
  for (const key of [
    "contract_confirmed",
    "admissions_handoff",
    "intake",
    "profile_and_route",
    "documents",
    "applications",
    "decisions",
    "visa_and_predeparture",
    "arrival_and_adaptation",
    "completed",
    "closed",
  ]) {
    assert.equal(admissionRu[`stage.${key}`], studentOperationalStage(key), key);
  }
  assert.equal(admissionRu.stageCustom, studentOperationalStage("nonstandard_stage_value"));

  // A pending, curator-less cabinet (S1's «кабинет до продажи») gets its own
  // quiet, accurate copy instead of a fabricated curator or stage.
  // PORT-6a: словарь pending-кабинета переехал из wording.portalPendingCabinet
  // в admission.pending* (RU байт-в-байт тот же — проверено ниже по значениям),
  // потому что этим экранам нужен KY, а staff-словарь не локализуется.
  // Заявка на рассмотрении — ровно одна карточка «Ваша анкета», в HomeView (tier approved); в OverviewView её нет,
  // иначе на /portal два заголовка «Ваша анкета» (смоук строг).
  const homeView = source("src/components/portal/home/HomeView.tsx");
  assert.doesNotMatch(overview, /pendingApplication|pendingManager|pending\??: boolean|\bpending = /u);
  assert.equal(homeView.match(/admission\.pendingApplicationHeading/gu)?.length, 1);
  // 18.11.2026: «Менеджер свяжется с вами» — текущий шаг дорожки анкеты, подписью без точки (как у сделанных шагов).
  assert.match(homeView, /strings\.applicationManagerStep/u);
  assert.match(homeView, /href="\/apply\/status"/u);
  // 03.11.2026: без карточки куратора pending-кабинет получает одну карточку
  // «Ваша анкета» с тем же честным текстом и ссылкой на статус.
  // Пояснение под «Ваша анкета» на экране не рисуется: заголовок и ссылка говорят сами.
  assert.doesNotMatch(overview, /strings\.pendingApplicationHint/u);
  assert.equal(admissionRu.pendingHeading, "Сопровождение");
  assert.equal(admissionRu.pendingManagerNotice, "Менеджер свяжется с вами.");
  assert.equal(admissionRu.pendingApplicationHeading, "Ваша анкета");
  assert.equal(admissionRu.pendingApplicationHint, "Анкета, которую вы отправили и одобрила команда EVO.");
  assert.equal(admissionRu.pendingApplicationLink, "Открыть анкету");
  assert.equal(admissionRu.curatorHeading, "Ваш куратор");
  assert.match(wording, /export const portalPendingCabinet = \{/u);
  assert.doesNotMatch(portalPage, /pending=\{/u, "the page does not pass the pending flag to the overview any more");

  // /apply/status stays reachable for a pending cabinet instead of bouncing
  // straight back to /portal (the only place the submitted анкета can be
  // read once a portal case exists).
  assert.match(applyStatusPage, /portal\.authority\.caseState === "pending"/u);
  assert.match(applyStatusPage, /if \(!stillPending\) redirect\(destination\);/u);
});

test("migration 131 adds a v2 overview while preserving the rollback v1", () => {
  const migration = source(
    "supabase/migrations/131_platform_student_portal_next_steps.sql",
  );

  assert.doesNotMatch(
    migration,
    /DROP FUNCTION platform\.student_portal_overview_v1\(\);/u,
  );
  assert.match(
    migration,
    /CREATE FUNCTION platform\.student_portal_overview_v2\(\)/u,
  );
  assert.doesNotMatch(
    migration,
    /CREATE(?: OR REPLACE)? FUNCTION platform\.student_portal_overview_v1\(\)/u,
  );
  assert.match(migration, /student_action_kind TEXT/u);
  assert.match(migration, /student_action_document_slot_id UUID/u);
  assert.match(migration, /evo_action_task_id UUID/u);
  assert.match(migration, /evo_action_status platform\.case_task_status/u);
  assert.match(
    migration,
    /slot\.status IN \('required', 'correction_required', 'rejected'\)/u,
  );
  assert.match(
    migration,
    /assignee_membership\."current_role" IN \('admin', 'sales', 'curator'\)/u,
  );
  assert.doesNotMatch(migration, /student_case\.next_action/u);
  assert.match(migration, /SECURITY DEFINER/u);
  assert.match(migration, /SET search_path = ''/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.student_portal_overview_v2\(\)\s+TO authenticated;/u,
  );
});

test("views consume the exact E2 DTOs without an invented wrapper", () => {
  // PORT-5d: перенос в Атлас не изобретает обёрточных DTO — те же E2-типы.
  for (const dir of ["src/components/staff/portal", "src/components/portal/admission"]) {
    assert.equal(existsSync(new URL(`${dir}/types.ts`, ROOT)), false, dir);
  }

  const expectedTypes = new Map([
    ["OverviewView.tsx", "StudentPortalOverview"],
    ["DocumentsView.tsx", "StudentPortalDocument"],
    ["PaymentsView.tsx", "PaymentCenter"],
    ["NotificationsView.tsx", "StudentPortalNotification"],
  ]);
  for (const [filename, typeName] of expectedTypes) {
    const view = source(`src/components/portal/admission/${filename}`);
    assert.match(view, new RegExp(`\\b${typeName}\\b`, "u"));
    assert.match(view, filename === "PaymentsView.tsx" ? /@\/lib\/portal\/payment-center/u : /@\/lib\/v3\/portal-source/u);
    assert.doesNotMatch(view, /Portal(?:Overview|Documents|Applications|Payments|Notifications)View/u);
    // Replace-don't-layer: старый v3-файл удалён, не задублирован.
    assert.equal(
      existsSync(new URL(`../src/components/staff/portal/${filename}`, import.meta.url)),
      false,
      filename,
    );
  }

  assert.equal(
    existsSync(new URL("../src/components/staff/portal/ApplicationsView.tsx", import.meta.url)),
    false,
  );
  const payments = source("src/components/portal/admission/PaymentsView.tsx");
  assert.match(payments, /paymentCategory\(due/u);
  assert.match(payments, /due\.refundedMinor/u);
  assert.doesNotMatch(payments, /paymentObligationId/u);
});

test("the single wording module maps every Student status exposed by E2", () => {
  const operationalStages = new Map([
    ["contract_confirmed", "договор подтверждён"],
    ["admissions_handoff", "передано в приёмную"],
    ["intake", "приём дела"],
    ["profile_and_route", "выбор программы"],
    ["documents", "сбор документов"],
    ["applications", "подача заявок в университеты"],
    ["decisions", "решения университетов"],
    ["visa_and_predeparture", "виза и подготовка к отъезду"],
    ["arrival_and_adaptation", "поездка и прибытие"],
    ["completed", "поступление завершено"],
    ["closed", "дело закрыто"],
  ]);
  // S6 (plan §9): document slot status becomes «Не загружен / На проверке /
  // Нужно исправить / Принят» (Pill-only presentation, so capitalized);
  // «Отклонён» stays as the fifth, honest state the plan's list doesn't
  // prohibit. Review decision keeps the same three words lowercase — it is
  // also read mid-sentence in ProfileDocumentsClient.tsx.
  const documentStatuses = new Map([
    ["required", "Не загружен"],
    ["submitted", "На проверке"],
    ["approved", "Принят"],
    ["correction_required", "Нужно исправить"],
    ["rejected", "Отклонён"],
  ]);
  const reviewDecisions = new Map([
    ["approved", "принят"],
    ["correction_required", "нужно исправить"],
    ["rejected", "отклонён"],
  ]);
  const paymentStatuses = new Map([
    ["pending", "ожидает оплаты"],
    ["partially_paid", "оплачено частично"],
    ["paid", "оплачено"],
    ["overdue", "просрочено"],
  ]);
  const paymentCategories = new Map([
    ["evo_service_fee", "услуги EVO"],
    ["third_party_cost", "сторонние расходы"],
  ]);

  for (const [value, label] of operationalStages) {
    assert.equal(studentOperationalStage(value), label);
  }
  for (const [value, label] of documentStatuses) {
    assert.equal(documentSlotStatus(value), label);
  }
  for (const [value, label] of reviewDecisions) {
    assert.equal(documentReviewDecision(value), label);
  }
  for (const [value, label] of paymentStatuses) {
    assert.equal(paymentObligationStatus(value), label);
  }
  for (const [value, label] of paymentCategories) {
    assert.equal(paymentObligationCategory(value), label);
  }

  for (const mapper of [
    documentSlotStatus,
    documentReviewDecision,
    paymentObligationStatus,
    paymentObligationCategory,
  ]) {
    assert.equal(mapper("unexpected_runtime_value"), null);
    assert.equal(mapper(null), null);
  }

  assert.equal(
    studentOperationalStage("admissions_validation"),
    "индивидуальный этап сопровождения",
  );
  assert.equal(
    studentOperationalStage("  Подготовка документов  "),
    "индивидуальный этап сопровождения",
  );
  assert.equal(studentOperationalStage("   "), null);
  assert.equal(studentOperationalStage(null), null);
});

test("Student stage wording matches the exact schema and published OZO lifecycle", () => {
  const studentCases = source(
    "supabase/migrations/042_platform_student_admissions.sql",
  );
  const workflowContracts = source(
    "supabase/migrations/051_platform_business_workflow_contracts.sql",
  );
  const handoff = source(
    "supabase/migrations/088_platform_sales_admissions_handoff.sql",
  );

  assert.match(
    studentCases,
    /operational_stage TEXT NOT NULL DEFAULT 'contract_confirmed'\s+CHECK \(btrim\(operational_stage\) <> ''\)/u,
  );
  assert.match(
    handoff,
    /operational_stage = 'admissions_handoff'/u,
  );

  const ozoContract = workflowContracts.match(
    /target\.workflow_kind = 'ozo'[\s\S]*?target\.stage_keys = ARRAY\[([\s\S]*?)\]::TEXT\[\]/u,
  );
  assert.ok(ozoContract);
  assert.deepEqual(
    [...ozoContract[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    [
      "intake",
      "profile_and_route",
      "documents",
      "applications",
      "decisions",
      "visa_and_predeparture",
      "arrival_and_adaptation",
      "completed",
      "closed",
    ],
  );
});

test("existing case portal views stay presentation-only and never render raw status keys", () => {
  // PORT-5d: экраны «Моего поступления» живут в portal/admission. PORT-8c:
  // экраны тестов переехали в portal/tests (их клиентский раннер сохраняет
  // useEffect-механику и закреплён tests/student-assessments.test.mjs).
  // d1404aef1 (#928, 2026-09-20) увёл последний файл из
  // src/components/staff/portal/ (PortalNotificationUpdates.tsx) в
  // src/components/portal/ — каталог src/components/staff/portal/ не существует
  // вовсе (проверено ниже), поэтому сканируем только portal/admission.
  assert.equal(existsSync(new URL("src/components/staff/portal/", ROOT)), false);
  const componentFiles = filesUnder("src/components/portal/admission/")
    .filter((path) => path.endsWith(".tsx"));
  const components = componentFiles.map(source).join("\n");

  assert.doesNotMatch(
    components,
    /meeting_scheduled|correction_required|under_review|not_started|document_slots|auth\.users|record_scopes/u,
  );
  assert.doesNotMatch(
    components,
    /createClient|supabase|sqlite|drizzle|Realtime|Fixture|Legacy|Connected/u,
  );
  // PortalNotificationUpdates.tsx (live poller, useEffect by design) now
  // lives at src/components/portal/ — outside this admission/-only scan, so
  // it needs no exclusion here any more; it is checked separately below.
  // PortalNotificationReadForm.tsx (436865af5, #1015, 2026-09-21) is a
  // client form wrapper, not a view: its useEffect only restores keyboard
  // focus after a failed submit and touches no read model — the actual
  // views (OverviewView, DocumentsView, PaymentsView, NotificationsView,
  // PortalStatus, presentation.ts) still may not use it.
  const presentationViews = componentFiles
    .filter((path) => !path.endsWith("/PortalNotificationReadForm.tsx"))
    .map(source).join("\n");
  assert.doesNotMatch(presentationViews, /useEffect/u);
  // Исключение узкое: ровно один эффект, и он только возвращает фокус.
  const readForm = source("src/components/portal/admission/PortalNotificationReadForm.tsx");
  assert.equal(readForm.match(/useEffect\(/gu)?.length, 1);
  assert.match(readForm, /useEffect\(\(\) => \{\s*if \(!failed \|\| pending \|\| !restoreFocusRef\.current\) return;[\s\S]*?\?\.focus\(\);\s*\}\s*\}, \[/u);
  assert.doesNotMatch(readForm, /@\/lib\/|fetch\(|setInterval|router\.refresh/u);
  const updates = source("src/components/portal/PortalNotificationUpdates.tsx");
  assert.match(updates, /createLightPoller/u);
  assert.match(source("src/lib/server/light-poll-route-handlers.ts"), /student_portal_poll_v1/u);
  assert.match(components, /<PortalStatus[\s\S]*label=/u);
  // PORT-6a: подпись «Что нужно исправить» — ключ admission.reworkTitle,
  // RU-значение прежнее байт-в-байт.
  assert.match(components, /strings\.reworkTitle/u);
  assert.equal(admissionRu.reworkTitle, "Что нужно исправить");
});

test("mark-read accepts one opaque handle and creates authority and replay data server-side", () => {
  const action = source("src/lib/student-portal-actions.ts");
  const notifications = source("src/components/portal/admission/NotificationsView.tsx");
  const submit = source(
    "src/components/portal/admission/PortalNotificationReadButton.tsx",
  );
  const browser = source("tests/e2e/student-portal.spec.ts");

  assert.match(action, /^"use server";/u);
  assert.match(action, /const actor = await requireStudentPortalActor\(\)/u);
  assert.match(action, /exactActionStringFields\(form, MARK_NOTIFICATION_READ_FIELDS\)/u);
  assert.match(action, /const MARK_NOTIFICATION_READ_FIELDS = \["notification_id"\] as const/u);
  assert.match(
    action,
    /requestId: studentPortalNotificationReadRequestId\(actor, notificationId\)/u,
  );
  assert.doesNotMatch(action, /randomUUID/u);
  assert.doesNotMatch(action, /form\.get\("request_id"\)|auth_user_id|organization_id|student_case_id/iu);
  assert.match(notifications, /PortalNotificationReadForm action=\{markReadAction\} errorMessage=\{strings\.markReadError\}/u);
  assert.match(notifications, /name="notification_id"/u);
  // PORT-6a: кнопка получает locale и берёт подписи из admission-словаря
  // (RU байт-в-байт прежние — проверено по словарю ниже).
  assert.match(notifications, /<PortalNotificationReadButton locale=\{locale\} \/>/u);
  assert.doesNotMatch(notifications, /onClick|fetch\(|useState/u);
  assert.match(submit, /^"use client";/u);
  assert.match(submit, /useFormStatus/u);
  assert.match(submit, /disabled=\{pending\}/u);
  assert.match(submit, /aria-disabled=\{pending\}/u);
  assert.match(
    submit,
    /pending \? strings\.marking : strings\.markRead/u,
  );
  assert.equal(admissionRu.marking, "Отмечаем…");
  assert.equal(admissionRu.markRead, "Отметить прочитанным");
  assert.match(
    browser,
    /const markReadSubmission = notification\.locator\('form button\[type="submit"\]'\);[\s\S]*await markReadSubmission\.click\(\);[\s\S]*await expect\(markReadSubmission\)\.toHaveCount\(0\)/u,
  );
});

test("notifications deep-link by category, and bulk mark-read loops the existing single action", () => {
  const presentation = source("src/components/portal/admission/presentation.ts");
  const notifications = source("src/components/portal/admission/NotificationsView.tsx");
  // #1358: лента одна — во «Входящих»; цикл прочтения живёт в messages/page.tsx,
  // а /portal/notifications — только переход на неё.
  const notificationsPage = source("src/app/(portal)/portal/messages/page.tsx");
  const legacyNotificationsPage = source("src/app/(portal)/portal/notifications/page.tsx");
  assert.match(legacyNotificationsPage, /redirect\("\/portal\/messages\?view=updates"\)/u);
  assert.doesNotMatch(legacyNotificationsPage, /NotificationsView|readStudentPortalNotifications/u);
  const markAll = source("src/components/portal/admission/PortalMarkAllReadButton.tsx");

  assert.match(presentation, /export function portalNotificationTarget/u);
  assert.match(presentation, /notification\.eventCode === "case_help_answer"/u);
  assert.match(presentation, /notification\.category\.startsWith\("document"\)/u);
  assert.match(presentation, /notification\.category\.startsWith\("payment"\)/u);
  // Retired screen (unified workflow S5): the never-emitted application/visa
  // categories no longer get their own branch — they fall through to the
  // same default overview link every other unknown category already uses.
  assert.doesNotMatch(
    presentation,
    /notification\.category\.startsWith\("application"\)|notification\.category\.startsWith\("visa"\)|Открыть заявки/u,
  );

  // PORT-6a: цели уведомлений локализуемы — helper получает admission-словарь.
  assert.match(notifications, /portalNotificationTarget\(notification, strings\)/u);
  assert.match(notifications, /href=\{target\.href\}/u);
  assert.match(notifications, /<PortalMarkAllReadButton locale=\{locale\} \/>/u);
  assert.match(notifications, /PortalNotificationReadForm action=\{markAllReadAction\} errorMessage=\{strings\.markAllReadError\}/u);

  assert.match(markAll, /^"use client";/u);
  assert.match(markAll, /useFormStatus/u);

  assert.match(
    notificationsPage,
    /async function markAllInboxUpdatesReadAction/u,
  );
  assert.match(notificationsPage, /"use server";/u);
  assert.match(
    notificationsPage,
    /if \(notification\.readAt !== null\) continue;/u,
  );
  assert.match(
    notificationsPage,
    /await markStudentPortalNotificationReadAction\(form\);/u,
  );
  // No new RPC: the loop calls the same exported action the per-item button uses.
  assert.doesNotMatch(notificationsPage, /\.schema\(|\.rpc\(/u);
});

test("notification command IDs replay per verified Student actor and notification", () => {
  const actor = {
    authUserId: "10000000-0000-4000-8000-000000000001",
    membershipId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000003",
    studentCaseId: "40000000-0000-4000-8000-000000000004",
  };
  const notificationId = "50000000-0000-4000-8000-000000000005";
  const requestId = studentPortalNotificationReadRequestId(actor, notificationId);

  assert.match(
    requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.equal(
    studentPortalNotificationReadRequestId(actor, notificationId),
    requestId,
  );
  assert.notEqual(
    studentPortalNotificationReadRequestId(
      { ...actor, authUserId: "60000000-0000-4000-8000-000000000006" },
      notificationId,
    ),
    requestId,
  );
  assert.notEqual(
    studentPortalNotificationReadRequestId(
      actor,
      "70000000-0000-4000-8000-000000000007",
    ),
    requestId,
  );

  for (const [field, value] of [
    ["authUserId", "not-a-uuid"],
    ["membershipId", "00000000-0000-0000-0000-000000000000"],
    ["organizationId", "30000000-0000-4000-0000-000000000003"],
    ["studentCaseId", ""],
  ]) {
    assert.throws(() =>
      studentPortalNotificationReadRequestId(
        { ...actor, [field]: value },
        notificationId,
      ),
    );
  }
  assert.throws(() =>
    studentPortalNotificationReadRequestId(actor, "not-a-uuid"),
  );
});

test("portal includes honest empty, loading and failure states", () => {
  const admission = filesUnder("src/components/portal/admission/")
    .filter((path) => path.endsWith(".tsx"))
    .map(source)
    .join("\n");
  const loading = source("src/app/(portal)/portal/loading.tsx");
  const error = source("src/app/(portal)/portal/error.tsx");

  // PORT-8c: пустое состояние каталога тестов — честный pt-empty из словаря
  // tests, а границы маршрута тестов рескинены на pt-классы.
  const testsCatalog = source("src/components/portal/tests/TestsCatalog.tsx");
  assert.match(testsCatalog, /pt-empty/u);
  assert.match(testsCatalog, /strings\.emptyTitle/u);
  assert.match(source("src/app/(portal)/portal/tests/loading.tsx"), /role="status"/u);
  assert.match(source("src/app/(portal)/portal/tests/error.tsx"), /role="alert"/u);
  // PORT-5d: пустые состояния Атласа — честный заголовок + следующий шаг.
  // PORT-6a: смоук-якорь «Список документов пока пуст» живёт RU-значением
  // ключа admission.documentsEmptyTitle (смоук-аккаунт — language=ru).
  assert.match(admission, /pt-adm-empty/u);
  assert.match(admission, /strings\.documentsEmptyTitle/u);
  assert.equal(admissionRu.documentsEmptyTitle, "Список документов пока пуст");
  assert.match(loading, /aria-busy="true"/u);
  assert.match(error, /role="alert"/u);
  // Текст границы живёт в portal/boundary-i18n.ts (RU + KY), error.tsx берёт его по <html lang>.
  assert.match(source("src/lib/portal/boundary-i18n.ts"), /Попробуйте ещё раз или откройте другой раздел через меню/u);
  assert.match(error, /useBoundaryStrings/u);
});

// This is deliberately structural. The cumulative E5 integration gate must
// still exercise 393px, forced-dark and axe against real Supabase-backed pages.
test("markup keeps responsive hooks and semantic navigation for the later browser gate", () => {
  // PORT-2: the shell is src/components/portal/Shell.tsx styled by --pt-*
  // tokens in src/app/(portal)/portal.css (design contract
  // docs/design/portal/design-contract.md). The mobile hamburger panel became
  // a fixed bottom tab bar, so the aria-expanded/menu-button pins retired with
  // it; responsive hooks, 44px targets and both themes now live in the CSS
  // file, and the production smoke anchors stay byte-for-byte in the TSX.
  const shell = source("src/components/portal/Shell.tsx");
  const portalCss = source("src/app/(portal)/portal.css");

  for (const removed of [
    "PortalShell.tsx",
    "PortalShell.module.css",
    "OverviewView.module.css",
    "DocumentsView.module.css",
  ]) {
    assert.equal(
      existsSync(new URL(`../src/components/staff/portal/${removed}`, import.meta.url)),
      false,
      removed,
    );
  }
  assert.match(shell, /data-testid="student-portal-shell"/u);
  assert.match(shell, /aria-label="Разделы кабинета"/u);
  assert.match(shell, /href="#portal-content"/u);
  assert.match(shell, /tabIndex=\{-1\}/u);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/u);
  assert.doesNotMatch(shell, /className="[^"]*\b(?:bg|text|border)-(?:surface|fg|accent|border)/u);
  assert.match(portalCss, /@media \(min-width: 768px\)/u);
  assert.match(portalCss, /@media \(max-width: 767px\)/u);
  assert.match(portalCss, /min-height: 44px/u);
  // 02.10: тёмная — только выбор студента (<html data-theme>), тема ОС не
  // читается: светлая — база, тёмные токены — на :root[data-theme="dark"].
  assert.match(portalCss, /:root\[data-theme="dark"\] \.pt-shell \{/u);
  assert.doesNotMatch(portalCss, /prefers-color-scheme/u);
  assert.match(portalCss, /@media \(prefers-reduced-motion: reduce\)/u);
  // PORT-5d: адаптивность «Моего поступления» живёт в pt-классах, не в
  // tailwind-утилитах: двухколоночный обзор схлопывается на узком экране,
  // суммы — auto-fit сетка.
  assert.match(portalCss, /\.pt-adm-grid \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1\.9fr\) minmax\(240px, 1fr\)/u);
  assert.match(portalCss, /@media \(max-width: 900px\) \{\s*\.pt-adm-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/u);
  assert.match(portalCss, /repeat\(auto-fit, minmax\(140px, 1fr\)\)/u);
});

test("portal feedback and status markers reuse the shared restrained visual language", () => {
  const documents = source("src/components/portal/admission/DocumentsView.tsx");
  const notifications = source("src/components/portal/admission/NotificationsView.tsx");
  const error = source("src/app/(portal)/portal/error.tsx");

  // PORT-6a: «Новое» — ключ admission.statusNew (RU байт-в-байт прежний).
  assert.match(
    notifications,
    /<PortalStatus label=\{strings\.statusNew\} tone="info" \/>/u,
  );
  assert.equal(admissionRu.statusNew, "Новое");
  assert.doesNotMatch(
    `${documents}\n${notifications}\n${error}`,
    /border-danger|bg-danger-weak|rounded-\[5px\] bg-info-weak/u,
  );
  assert.match(documents, /role="note"/u);
  // PORT-6a: aria-label локализуется тем же ключом admission.reworkTitle,
  // что и видимый заголовок блока.
  assert.match(documents, /aria-label=\{strings\.reworkTitle\}/u);
});

test("the Student portal structural contract is registered exactly once", () => {
  const packageJson = JSON.parse(source("package.json"));
  const registrations = Object.values(packageJson.scripts)
    .filter((command) => command.includes("tests/v3-student-portal-ui.test.mjs"));

  assert.equal(registrations.length, 1);
  assert.match(packageJson.scripts["test:frontend"], /tests\/v3-student-portal-ui\.test\.mjs/u);
});

test("330: a staff message notifies the student once per unread and the notification leads to the messages", () => {
  const fileOf = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const source = fileOf("supabase/migrations/330_platform_case_chat_student_notification.sql");
  assert.ok(source.indexOf("a330_already_applied") < source.indexOf("a330_anchor_drift"));
  assert.match(source, /student_portal_notifications_v2\(\)'/u);
  assert.match(source, /mark_own_student_portal_notification_read_v2\(uuid,uuid\)'/u, "the read command accepts it, otherwise a read one blocks new ones");
  assert.match(source, /REVOKE ALL ON FUNCTION platform_private\.own_case_chat_notifications\(\) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
  assert.doesNotMatch(source.replaceAll("NEW.body = ''", ""), /NEW\.body/u, "the notification holds no message text");
  assert.match(fileOf("src/components/portal/admission/presentation.ts"), /eventCode === "case_chat_message"[\s\S]*?href: "\/portal\/messages", label: strings\.targetMessages/u);
  const i18n = fileOf("src/lib/portal/i18n.ts");
  // 03.11.2026: «Сообщения» стали «Входящими» — ссылка ведёт к переписке в них.
  assert.match(i18n, /targetMessages: "Открыть переписку"/u);
  assert.match(i18n, /targetMessages: "Кат алышууну ачуу"/u);
  const script = fileOf("scripts/test-runners/test-postgres-authorization.sh");
  assert.match(fileOf("supabase/tests/platform_case_chat_student_notification.sql"), /ROLLBACK;\s*$/u);
  assert.ok(script.indexOf("A330_CASE_CHAT_STUDENT_NOTIFICATION_SUITE_PASSED") > 0 && script.indexOf("A330_CASE_CHAT_STUDENT_NOTIFICATION_SUITE_PASSED") < script.indexOf('done < <(\n  cd "$repo_root"\n  find supabase/migrations'));
  assert.match(script, /a330_already_applied/u);
});

test("331: reading the chat clears only the notification of the portal case the chat shows", () => {
  const fileOf = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const migration = fileOf("supabase/migrations/331_platform_case_chat_read_scope.sql");
  assert.ok(migration.indexOf("a331_already_applied") < migration.indexOf("a331_anchor_drift"));
  assert.ok(migration.includes("platform_private.require_case_operations_actor(NULL, TRUE)"), "the case is the one the chat page shows");
  assert.ok(migration.includes("AND n.student_case_id = gate.student_case_id"), "only that case's notification is cleared");
  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.mark_own_case_chat_notifications_read_v1\(p_up_to_sequence_id BIGINT\)\s+RETURNS INTEGER/u, "signature and result shape stay");
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.mark_own_case_chat_notifications_read_v1\(BIGINT\) TO authenticated;/u);
  assert.ok(fileOf("src/lib/portal/messages-actions.ts").includes('.rpc("mark_own_case_chat_notifications_read_v1", { p_up_to_sequence_id: upToSequenceId })'), "the caller is unchanged");
  assert.match(fileOf("supabase/tests/platform_case_chat_read_scope.sql"), /ROLLBACK;\s*$/u);
  const script = fileOf("scripts/test-runners/test-postgres-authorization.sh");
  assert.ok(script.indexOf("A331_CASE_CHAT_READ_SCOPE_SUITE_PASSED") > 0 && script.indexOf("A331_CASE_CHAT_READ_SCOPE_SUITE_PASSED") < script.indexOf('done < <(\n  cd "$repo_root"\n  find supabase/migrations'));
  assert.match(script, /a331_already_applied/u);
  const presentation = fileOf("src/components/portal/admission/presentation.ts");
  assert.ok(presentation.indexOf("One deep link per notification") > presentation.indexOf("export function portalNotificationText"), "the doc comment sits over portalNotificationTarget");
  assert.ok(presentation.indexOf("One deep link per notification") < presentation.indexOf("export function portalNotificationTarget"));
});

test("330: the shown chat clears the notification and its text follows the student's language", () => {
  const fileOf = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const hook = fileOf("src/components/portal/messages/useMarkCaseChatRead.ts");
  assert.ok(hook.includes('document.visibilityState !== "visible"'), "a hidden tab does not read");
  assert.ok(fileOf("src/components/portal/messages/MessagesThread.tsx").includes("useMarkCaseChatRead(messages[messages.length - 1]?.sequenceId ?? null, rootRef)"));
  assert.ok(fileOf("src/lib/portal/messages-actions.ts").includes('.rpc("mark_own_case_chat_notifications_read_v1", { p_up_to_sequence_id: upToSequenceId })'));
  const presentation = fileOf("src/components/portal/admission/presentation.ts");
  assert.ok(presentation.includes("return { title: strings.caseChatNotificationTitle, detail: strings.caseChatNotificationDetail };"));
  const view = fileOf("src/components/portal/admission/NotificationsView.tsx");
  assert.ok(view.includes("{text.title}"));
  assert.ok(!view.includes("{notification.subjectLabel}"), "the stored Russian text does not reach the screen directly");
  const i18n = fileOf("src/lib/portal/i18n.ts");
  assert.equal((i18n.match(/caseChatNotificationTitle:/gu) ?? []).length, 2, "both languages");
  assert.match(i18n, /caseChatNotificationTitle: "EVO командасынан жаңы билдирүү"/u);
  const migration = fileOf("supabase/migrations/330_platform_case_chat_student_notification.sql");
  assert.ok(!migration.includes("AND NOT EXISTS (SELECT 1 FROM platform.notifications"), "the unique index holds one unread, not a racing check");
  assert.match(migration, /CREATE UNIQUE INDEX notifications_case_chat_one_unread/u);
  assert.ok(migration.includes("m.sequence_id > p_up_to_sequence_id AND m.author_membership_id <> actor.membership_id"), "a newer staff message keeps it unread");
  assert.match(fileOf("supabase/tests/platform_case_chat_student_notification.sql"), /read the chat without the bell: the next message notifies again/u);
});

// #1341: the interrupted-upload link is a cue for the whole overview, not for
// one tab. PendingPackagesLink is client-only (it reads this device's
// localStorage and renders null until hydrated), so a server render cannot show
// it; the contract is pinned on where the overview places it.
test("the home shows the pending-packages link above the tabs on every view", () => {
  const page = source("src/app/(portal)/portal/page.tsx");
  assert.equal(page.match(/<PendingPackagesLink\b/gu)?.length, 1, "exactly one link on the home");
  const link = page.indexOf("<PendingPackagesLink");
  const tabs = page.indexOf("<HomeList");
  const viewBranch = page.indexOf('view === "universities" ?');
  assert.ok(link > 0 && tabs > link, "the link renders above the tabs");
  assert.ok(viewBranch > tabs, "the link is outside the view branch, so the default tab shows it");
  assert.match(page, /label=\{packageStrings\(locale\)\.pendingTitle\}/u);
  assert.match(source("src/components/portal/home/HomeList.tsx"), /<nav className="pt-pill-tabs" aria-label=\{admission\.tabsLabel\}>/u);
  assert.match(source("src/components/portal/applicationPackages/PendingPackagesLink.tsx"), /href="\/portal\/package-recovery"/u);
  assert.match(source("src/app/(portal)/portal.css"), /\.pt-pending-packages:not\(:empty\)/u);
});
