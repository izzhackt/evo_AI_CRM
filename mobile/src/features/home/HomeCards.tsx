// Карточки «Главной» (HomeCase, HomeDates, HomeNews, CscaHomeCard, карточка анкеты approved и задача EVO из
// OverviewView; веб #1412, #1355, #1489). Каждая карточка получает уже прочитанные данные и своё состояние: сбой
// одного источника не трогает остальные. Шапка пути (приветствие, строка текущего шага, весь путь) - JourneySection.
import { Bell, CalendarDays, Check, ClipboardCheck, FileText, MessagesSquare, Wallet, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";
import type { CscaHomeCardView } from "@web/lib/portal/csca-home-card";
import { homeDaysLabel, homeDaysUntil, homeMonthShort, homeTimeLabel, homeWeek, laterHomeDate, upcomingHomeDates, type HomeDateItem } from "@web/lib/portal/home-dates";
import { formatPortalString } from "@web/lib/portal/i18n";
import { nearestUniversityIntake, universityDateLabel, universityMonthLabel } from "@web/lib/portal/universities";

import { applicationSteps, caseRows, homeDueStatus, type HomeApplication, type HomeNewsView } from "@/domain/home-model";
import type { StudentPortalAction, StudentPortalEvoAction, StudentPortalOverview } from "@/domain/portal-source";
import {
  actionTarget,
  actionTitle,
  evoActionDueLabel,
  evoActionStatusLabel,
  evoActionTone,
  formatPortalMoney,
  notificationRoute,
  portalNotificationKind,
  portalNotificationText,
  studentActionDueLabel,
  type PortalNotificationKind,
} from "@/domain/presentation";
import { APPLICATION_ROUTE, go, goStamped, openLink } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, EmptyBlock, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

type Load = { state: "loading" } | { state: "error"; message: string; onRetry: () => void };

function Skeletons({ load, label }: { load: Load; label: string }) {
  const { m } = useLang();
  return load.state === "loading" ? (
    <CardSkeleton label={`${label}. ${m("state.loading")}`} />
  ) : (
    <InlineAlert message={load.message} retryLabel={m("gate.retry")} onRetry={load.onRetry} testID="card-error" />
  );
}

/** Значок в плитке (веб HomeIcon: 20 px у первой плитки, 18 у строк; тот же набор Lucide, что у меню). */
function Tile({ icon: Icon, size, accent = false }: { icon: LucideIcon; size: number; accent?: boolean }) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: tokens.radiusItem, alignItems: "center", justifyContent: "center", backgroundColor: accent ? tokens.accentSoft : tokens.bg }}
    >
      <Icon size={accent ? 20 : 18} strokeWidth={1.75} color={accent ? tokens.accent : tokens.text2} />
    </View>
  );
}

// ---- Что сделать сейчас ----------------------------------------------------------

/** «?» в шапке карточки: пояснение «откуда это» по нажатию, а не строкой на экране (веб HomeHint, 18.11.2026). */
function HintButton({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      hitSlop={4}
      testID="case-hint"
      style={{ width: MIN_TARGET, height: MIN_TARGET, marginVertical: -8, marginRight: -12, alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: open ? tokens.text : tokens.text2, alignItems: "center", justifyContent: "center" }}>
        <Text variant="caption" bold style={{ color: open ? tokens.text : tokens.text2, lineHeight: 15 }}>
          ?
        </Text>
      </View>
    </Pressable>
  );
}

function actionIcon(action: StudentPortalAction): LucideIcon {
  return action.kind === "payment" ? Wallet : FileText;
}

/** Срок дела словом в пилюле: «через 5 дней», «завтра», красным «просрочено на 3 дня» (HomeCase DueStatus, веб). */
function DueStatus({ dueAt, now, testID }: { dueAt: string; now: Date; testID?: string }) {
  const { lang, t } = useLang();
  const status = homeDueStatus(dueAt, now, lang, t("home"));
  return <StatusPill label={status.label} tone={status.tone} testID={testID} />;
}

export function CaseCard({ overview, load, now }: { overview: StudentPortalOverview | null; load: Load | null; now: Date }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const home = t("home");
  const admission = t("admission");
  const { primary, next, remaining } = caseRows(overview);
  const primaryDue = primary ? studentActionDueLabel(primary) : null;
  const [hint, setHint] = useState(false);
  const failed = load !== null;
  return (
    <Card>
      <CardHead
        title={home.caseHeading}
        count={failed ? null : (overview?.studentActions.length ?? null)}
        action={failed ? null : <HintButton label={home.caseHint} open={hint} onPress={() => setHint((value) => !value)} />}
      />
      {hint ? (
        <View style={{ padding: 12, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.bg }} testID="case-hint-text">
          <Text variant="caption">{home.caseFoot}</Text>
        </View>
      ) : null}
      {load ? (
        <Skeletons load={load} label={home.caseHeading} />
      ) : primary ? (
        <View style={{ gap: 12 }} testID="case-primary">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Tile icon={actionIcon(primary)} size={36} accent />
            <Text variant="heading" style={{ flex: 1 }}>
              {actionTitle(primary, admission)}
            </Text>
          </View>
          {/* Срок и сумма - только когда они есть: «Срок: не указан» ничего не сообщает. */}
          {(primaryDue && primary.dueAt) || primary.kind === "payment" ? (
            <View style={{ gap: 8 }}>
              {primaryDue && primary.dueAt ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <Text variant="secondary" tone="text2">
                    {admission.dueTerm}
                  </Text>
                  <Text variant="secondary">{primaryDue}</Text>
                  <DueStatus dueAt={primary.dueAt} now={now} testID="case-primary-due" />
                </View>
              ) : null}
              {primary.kind === "payment" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
                  <Text variant="secondary" tone="text2">
                    {admission.amountTerm}
                  </Text>
                  <Text variant="data">{formatPortalMoney(primary.amountMinor, primary.currency)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {/* Красная кнопка только у первого дела: следующие - строками ниже. */}
          <Button
            label={primary.kind === "payment" ? admission.openPayment : admission.openDocument}
            onPress={() => go(actionTarget(primary).route)}
            testID="case-open"
          />
        </View>
      ) : (
        <EmptyBlock icon={ClipboardCheck} title={overview ? admission.calmDone : admission.calmNoPlan} />
      )}
      {!failed && (next.length > 0 || remaining > 0) ? (
        <View testID="case-rest" style={{ marginHorizontal: -16, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: tokens.line }}>
          {next.map((action, index) => {
            const due = action.dueAt ? studentActionDueLabel(action) : null;
            const title = actionTitle(action, admission);
            return (
              <Pressable
                key={action.kind === "payment" ? `payment-${index}` : action.documentSlotId}
                accessibilityRole="button"
                accessibilityLabel={`${title}${due ? `. ${admission.dueTerm} ${due}` : ""}`}
                onPress={() => go(actionTarget(action).route)}
                testID={`case-next-${index}`}
                style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.line }}
              >
                <Tile icon={actionIcon(action)} size={32} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="secondary" style={{ fontFamily: sansFont("medium") }}>
                    {title}
                  </Text>
                  {due && action.dueAt ? (
                    <View style={{ flexDirection: "row" }}>
                      <DueStatus dueAt={action.dueAt} now={now} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {remaining > 0 ? <LinkButton label={format(home.caseMore, { count: String(remaining) })} onPress={() => go("/documents")} testID="case-more" /> : null}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * approved: вместо «Что сделать сейчас» карточка «Ваша анкета» (веб: ссылка на /apply/status). Отметки с датами из своей
 * анкеты - что уже сделано (зелёная галочка), текущий шаг «Менеджер свяжется с вами» без срока (веб #1489).
 */
export function ApplicationCard({ application, now }: { application: HomeApplication | null; now: Date }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const home = t("home");
  const admission = t("admission");
  const steps = applicationSteps(application, now, lang, home);
  return (
    <Card>
      <Text variant="caption" tone="text2" bold style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
        {home.applicationKicker}
      </Text>
      <Text variant="heading" accessibilityRole="header">
        {admission.pendingApplicationHeading}
      </Text>
      <View testID="application-steps" accessibilityRole="list">
        {steps.map((step, index) => (
          <View key={step.text} testID={`application-step-${step.kind}`} style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 10 }}>
            {index > 0 ? <View style={{ position: "absolute", top: -7, left: 10, height: 14, borderLeftWidth: 1, borderLeftColor: tokens.line }} /> : null}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: step.kind === "current" ? 2 : 1.5, borderColor: step.kind === "done" ? tokens.ok : step.kind === "current" ? tokens.text : tokens.controlEdge }}
            >
              {step.kind === "done" ? <Check size={14} strokeWidth={2.5} color={tokens.ok} /> : null}
            </View>
            <Text variant="secondary" bold={step.kind === "current"} style={{ flex: 1 }}>
              {step.text}
            </Text>
            {step.date ? (
              <Text variant="caption" tone="text2">
                {step.date}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <Button label={admission.pendingApplicationLink} variant="ghost" onPress={() => go(APPLICATION_ROUTE)} testID="application-open" />
    </Card>
  );
}

/** Задача команды EVO (OverviewView, веб): под шапкой «Главной», только когда она есть. */
export function EvoTaskCard({ action }: { action: StudentPortalEvoAction }) {
  const { tokens } = useTheme();
  const { t } = useLang();
  const admission = t("admission");
  const due = evoActionDueLabel(action);
  const tone = evoActionTone(action);
  return (
    <Card>
      <Text variant="heading" accessibilityRole="header">
        {admission.evoHeading}
      </Text>
      <Text variant="body" bold testID="evo-title">
        {action.title}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: tokens.radiusChip, backgroundColor: tone === "warn" ? tokens.accentSoft : tokens.skeleton }}>
          <Text variant="caption" bold tone={tone === "warn" ? "error" : "text"}>
            {evoActionStatusLabel(action, admission)}
          </Text>
        </View>
        {due ? (
          <Text variant="secondary" tone="text2">
            {admission.dueTerm} {due}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

// ---- Ближайший набор (общий текст для «Мой список» и дат) ----------------------------

export function nearestIntakeText(item: PublishedUniversity, lang: "ru" | "ky", now: Date, strings: { intakeDatesPending: string; intakeDeadlineByDate: string; intakeStartFromDate: string }): string {
  const nearest = nearestUniversityIntake(item.content, now);
  if (nearest === null) return strings.intakeDatesPending;
  if (nearest.kind === "deadline") return formatPortalString(strings.intakeDeadlineByDate, { date: universityDateLabel(nearest.value, lang) });
  return formatPortalString(strings.intakeStartFromDate, {
    date: nearest.kind === "start" ? universityDateLabel(nearest.value, lang) : universityMonthLabel(nearest.value, lang),
  });
}

// ---- Ближайшие даты --------------------------------------------------------------

function weekday(day: string, lang: "ru" | "ky"): string {
  return new Intl.DateTimeFormat(lang === "ky" ? "ky" : "ru", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** Строка даты: плитка «число и месяц», название и под ним сколько осталось (веб HomeDates, 18.11.2026; на телефоне - под названием). */
function DateRow({ item, right, soon, separated }: { item: HomeDateItem; right: string | null; soon: boolean; separated: boolean }) {
  const { lang } = useLang();
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${universityDateLabel(item.day, lang)}. ${item.title}${right ? `. ${right}` : ""}`}
      onPress={() => goStamped(item.href)}
      style={{ minHeight: MIN_TARGET, flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 10, borderTopWidth: separated ? 1 : 0, borderTopColor: tokens.line }}
      testID={`date-${item.day}`}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 44, height: 44, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg, alignItems: "center", justifyContent: "center" }}
      >
        <Text variant="body" bold style={{ fontVariant: ["tabular-nums"], lineHeight: 18 }}>
          {Number(item.day.slice(8))}
        </Text>
        <Text variant="caption" tone="text2" bold style={{ lineHeight: 14 }}>
          {homeMonthShort(item.day, lang)}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="secondary">{item.title}</Text>
        {right ? (
          <Text variant="caption" tone={soon ? "text" : "text2"} bold={soon} testID={`date-left-${item.day}`}>
            {right}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * «Ближайшие даты» (веб HomeDates): неделя от сегодня (сегодня - красным кругом, дни с пунктом - точкой) и до пяти
 * пунктов на 60 дней вперёд: сроки дел студента, сроки своих программ, дедлайн или старт избранных вузов и официальные
 * даты CSCA у выбравшего Китай. Если в окне дат нет, а позже есть, вместо «Дат пока нет» - «Дальше» и первая такая дата.
 */
export function DatesCard({ items, today }: { items: readonly HomeDateItem[]; today: string }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const home = t("home");
  const upcoming = upcomingHomeDates(items, today);
  const later = upcoming.length === 0 ? laterHomeDate(items, today) : null;
  const marked = new Set(items.map((item) => item.day));
  return (
    <Card>
      <CardHead title={home.datesHeading} count={upcoming.length} />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: 4 }} testID="week-strip">
        {homeWeek(today).map((day) => {
          const isToday = day === today;
          return (
            <View key={day} style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <Text variant="caption" tone="text2">
                {weekday(day, lang)}
              </Text>
              <View
                testID={isToday ? "week-today" : undefined}
                style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? tokens.accent : "transparent" }}
              >
                <Text variant="secondary" bold style={{ color: isToday ? tokens.onAccent : tokens.text, fontVariant: ["tabular-nums"] }}>
                  {Number(day.slice(8))}
                </Text>
              </View>
              <View testID={marked.has(day) ? `week-marked-${day}` : undefined} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: marked.has(day) ? tokens.text : "transparent" }} />
            </View>
          );
        })}
      </View>
      {upcoming.length > 0 ? (
        <View accessibilityRole="list">
          {upcoming.map((item, index) => {
            const days = homeDaysUntil(item.day, today);
            return <DateRow key={`${item.day}-${item.href}-${item.title}`} item={item} right={homeDaysLabel(days, lang, home)} soon={days <= 1} separated={index > 0} />;
          })}
        </View>
      ) : later ? (
        <View style={{ gap: 2 }} testID="dates-later">
          <Text variant="caption" tone="text2" bold>
            {home.datesLater}
          </Text>
          <DateRow item={later} right={later.day.slice(0, 4) === today.slice(0, 4) ? null : later.day.slice(0, 4)} soon={false} separated={false} />
        </View>
      ) : (
        <EmptyBlock compact icon={CalendarDays} title={home.datesEmptyTitle} body={home.datesEmptyBody} />
      )}
    </Card>
  );
}

// ---- Что нового ------------------------------------------------------------------

const KIND_ICON: Record<PortalNotificationKind, LucideIcon> = {
  package: ClipboardCheck,
  document: FileText,
  message: MessagesSquare,
  payment: Wallet,
  other: Bell,
};

export function NewsCard({ news, load, now }: { news: HomeNewsView | null; load: Load | null; now: Date }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const home = t("home");
  const messages = t("messages");
  const admission = t("admission");
  return (
    <Card>
      <CardHead
        title={messages.updatesTitle}
        count={news?.unread ?? null}
        action={news && news.items.length > 0 ? <LinkButton label={home.newsAll} onPress={() => go("/messages/updates")} testID="news-all" /> : null}
      />
      {load ? (
        <Skeletons load={load} label={messages.updatesTitle} />
      ) : !news || news.items.length === 0 ? (
        <EmptyBlock icon={MessagesSquare} title={admission.notificationsEmptyTitle} body={admission.notificationsEmptyBody} />
      ) : (
        <View accessibilityRole="list">
          {news.items.map((item, index) => {
            const text = portalNotificationText(item, admission);
            // Время словом: «сегодня, 14:00», «вчера», «3 дня назад» (веб HomeNews, 18.11.2026).
            const when = homeTimeLabel(item.createdAt, now, lang, home);
            const unread = item.readAt === null;
            const Icon = KIND_ICON[portalNotificationKind(item)];
            return (
              <Pressable
                key={item.notificationId}
                accessibilityRole="button"
                accessibilityLabel={`${unread ? `${admission.statusNew}: ` : ""}${text.title}${when ? `. ${when}` : ""}`}
                onPress={() => go(notificationRoute(item))}
                testID={`news-${item.notificationId}`}
                style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.line }}
              >
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Tile icon={Icon} size={32} />
                  {unread ? (
                    <View
                      testID={`news-unread-${item.notificationId}`}
                      style={{ position: "absolute", top: -3, right: -3, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: tokens.surface, backgroundColor: tokens.accent }}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="secondary" bold={unread}>
                    {text.title}
                  </Text>
                  {when ? (
                    <Text variant="caption" tone="text2">
                      {when}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}

// ---- CSCA (только Китай) -----------------------------------------------------------

/**
 * Короткая карточка CSCA: название, строка обзора, ближайшая сессия и «К подготовке». Срок регистрации здесь не
 * рисуется (веб, 19.11.2026): та же дата уже стоит строкой в «Ближайших датах», второй раз она ничего не сообщает.
 */
export function CscaCard({ view }: { view: CscaHomeCardView }) {
  return (
    <Card>
      <Text variant="heading" accessibilityRole="header">
        {view.title}
      </Text>
      <Text variant="secondary">{view.summary}</Text>
      {view.session ? (
        <View style={{ gap: 2 }} testID="csca-session">
          <Text variant="secondary" tone="text2">
            {view.session.line}
          </Text>
        </View>
      ) : null}
      <Button variant="ghost" label={view.action} onPress={() => openLink(view.href)} testID="csca-open" />
    </Card>
  );
}
