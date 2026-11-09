// Карточки «Главной» (HomeCase, HomeJourneyCard, HomeWriteEvo, HomeDates, HomeNews,
// CscaHomeCard, карточка анкеты approved и задача EVO из OverviewView; веб #1412, #1355). Каждая карточка получает уже
// прочитанные данные и своё состояние: сбой одного источника не трогает остальные.
import { CalendarDays, ClipboardCheck, MessagesSquare } from "lucide-react-native";
import { Pressable, View } from "react-native";
import type { PublishedUniversity } from "@web/lib/platform-university-catalog";
import type { CountryTimelineView, TimelineStepProgress } from "@web/lib/portal/country-timeline";
import type { CscaHomeCardView } from "@web/lib/portal/csca-home-card";
import { homeWeek, upcomingHomeDates, type HomeDateItem } from "@web/lib/portal/home-dates";
import { formatPortalString } from "@web/lib/portal/i18n";
import { nearestUniversityIntake, universityDateLabel, universityMonthLabel } from "@web/lib/portal/universities";

import type { HomeNewsView } from "@/domain/home-model";
import type { StudentPortalEvoAction, StudentPortalOverview } from "@/domain/portal-source";
import { actionTarget, actionTitle, evoActionDueLabel, evoActionStatusLabel, evoActionTone, formatPortalMoney, formatPortalTimestamp, notificationRoute, portalNotificationText, studentActionDueLabel } from "@/domain/presentation";
import { APPLICATION_ROUTE, go, openLink, WRITE_EVO_ROUTE } from "@/features/portal/navigation";
import { JourneyMeter } from "@/features/portal/JourneyMeter";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, EmptyBlock, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
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

// ---- Что сделать сейчас ----------------------------------------------------------

export function CaseCard({ overview, load }: { overview: StudentPortalOverview | null; load: Load | null }) {
  const { t } = useLang();
  const home = t("home");
  const admission = t("admission");
  const { format } = useLang();
  const primary = overview?.studentAction ?? null;
  const remaining = overview ? overview.studentActions.length - 1 : 0;
  const due = primary ? studentActionDueLabel(primary) : null;
  return (
    <Card>
      <CardHead title={home.caseHeading} />
      {load ? (
        <Skeletons load={load} label={home.caseHeading} />
      ) : primary ? (
        <View style={{ gap: 12 }} testID="case-primary">
          <Text variant="body" bold>
            {actionTitle(primary, admission)}
          </Text>
          {(due && primary.dueAt) || primary.kind === "payment" ? (
            <View style={{ gap: 4 }}>
              {due && primary.dueAt ? (
                <Text variant="secondary" tone="text2">
                  {admission.dueTerm} <Text variant="secondary">{due}</Text>
                </Text>
              ) : null}
              {primary.kind === "payment" ? (
                <Text variant="secondary" tone="text2">
                  {admission.amountTerm} <Text variant="data">{formatPortalMoney(primary.amountMinor, primary.currency)}</Text>
                </Text>
              ) : null}
            </View>
          ) : null}
          <Button
            label={primary.kind === "payment" ? admission.openPayment : admission.openDocument}
            onPress={() => go(actionTarget(primary).route)}
            testID="case-open"
          />
          {remaining > 0 ? <LinkButton label={format(home.caseMore, { count: String(remaining) })} onPress={() => go("/documents")} testID="case-more" /> : null}
        </View>
      ) : (
        <EmptyBlock icon={ClipboardCheck} title={overview ? admission.calmDone : admission.calmNoPlan} />
      )}
      {load?.state === "error" ? null : (
        <Text variant="caption" tone="text2">
          {home.caseFoot}
        </Text>
      )}
    </Card>
  );
}

/** approved: вместо «Что сделать сейчас» карточка «Ваша анкета» (веб: ссылка на /apply/status). */
export function ApplicationCard() {
  const { t } = useLang();
  const home = t("home");
  const admission = t("admission");
  return (
    <Card>
      <Text variant="caption" tone="text2" bold>
        {home.applicationKicker}
      </Text>
      <Text variant="heading" accessibilityRole="header">
        {admission.pendingApplicationHeading}
      </Text>
      <Text variant="secondary" tone="text2">
        {admission.pendingManagerNotice}
      </Text>
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

/** «Написать EVO» (HomeWriteEvo, веб #1356): один вход к команде, чат «Входящих». Только assisted. */
export function WriteEvoCard() {
  const { t } = useLang();
  const home = t("home");
  return (
    <Card>
      <CardHead title={home.writeHeading} />
      <Text variant="secondary" tone="text2">
        {home.writeBody}
      </Text>
      <Button label={home.writeAction} onPress={() => go(WRITE_EVO_ROUTE)} testID="write-evo" />
    </Card>
  );
}

// ---- Путь ------------------------------------------------------------------------

export function JourneyCard({ view, progress, onOpenPath }: { view: CountryTimelineView; progress: Readonly<Record<string, TimelineStepProgress>> | null; onOpenPath: () => void }) {
  const { t, format } = useLang();
  const home = t("home");
  const timeline = t("timeline");
  const current = view.steps.find((step) => progress?.[step.id] === "current") ?? null;
  const title = view.countryName ? format(home.pathTitle, { country: view.countryName }) : timeline.heading;
  return (
    <Card>
      <CardHead title={title} action={<LinkButton label={home.pathAll} onPress={onOpenPath} testID="journey-all" />} />
      {current ? (
        <View style={{ gap: 8 }} accessible accessibilityLabel={`${home.pathNow} ${current.title}. ${format(timeline.stepOf, { n: String(current.order), total: String(view.steps.length) })}`}>
          <Text variant="secondary" testID="journey-current">
            <Text variant="secondary" tone="text2">
              {home.pathNow}{" "}
            </Text>
            <Text variant="secondary" bold>
              {current.title}
            </Text>
          </Text>
          <JourneyMeter steps={view.steps} progress={progress} />
        </View>
      ) : (
        <Text variant="secondary" tone="text2">
          {view.intake.label}
        </Text>
      )}
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

export function DatesCard({ items, today }: { items: readonly HomeDateItem[]; today: string }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const home = t("home");
  const upcoming = upcomingHomeDates(items, today);
  const marked = new Set(items.map((item) => item.day));
  return (
    <Card>
      <CardHead title={home.datesHeading} count={upcoming.length} />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: 4 }} testID="week-strip">
        {homeWeek(today).map((day) => {
          const isToday = day === today;
          return (
            <View
              key={day}
              testID={isToday ? "week-today" : undefined}
              style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 6, borderRadius: tokens.radiusItem, backgroundColor: isToday ? tokens.accent : "transparent" }}
            >
              <Text variant="caption" style={{ color: isToday ? tokens.onAccent : tokens.text2 }}>
                {weekday(day, lang)}
              </Text>
              <Text variant="secondary" bold style={{ color: isToday ? tokens.onAccent : tokens.text }}>
                {Number(day.slice(8))}
              </Text>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: marked.has(day) ? (isToday ? tokens.onAccent : tokens.accent) : "transparent" }} />
            </View>
          );
        })}
      </View>
      {upcoming.length === 0 ? (
        <EmptyBlock icon={CalendarDays} title={home.datesEmptyTitle} body={home.datesEmptyBody} />
      ) : (
        <View accessibilityRole="list">
          {upcoming.map((item) => (
            <Pressable
              key={`${item.day}-${item.href}-${item.title}`}
              accessibilityRole="button"
              accessibilityLabel={`${universityDateLabel(item.day, lang)}. ${item.title}`}
              onPress={() => go(item.href)}
              style={{ minHeight: MIN_TARGET, flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 6 }}
              testID={`date-${item.day}`}
            >
              <Text variant="data" style={{ minWidth: 92 }}>
                {universityDateLabel(item.day, lang)}
              </Text>
              <Text variant="secondary" style={{ flex: 1 }}>
                {item.title}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

// ---- Что нового ------------------------------------------------------------------

export function NewsCard({ news, load }: { news: HomeNewsView | null; load: Load | null }) {
  const { t } = useLang();
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
          {news.items.map((item) => {
            const text = portalNotificationText(item, admission);
            const created = formatPortalTimestamp(item.createdAt);
            const unread = item.readAt === null;
            return (
              <Pressable
                key={item.notificationId}
                accessibilityRole="button"
                accessibilityLabel={`${unread ? `${admission.statusNew}: ` : ""}${text.title}${created ? `. ${created}` : ""}`}
                onPress={() => go(notificationRoute(item))}
                testID={`news-${item.notificationId}`}
                style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: unread ? tokens.accent : "transparent" }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="secondary" bold={unread}>
                    {text.title}
                  </Text>
                  {created ? (
                    <Text variant="caption" tone="text2">
                      {created}
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
          {view.session.registration ? (
            <Text variant="secondary" bold>
              {view.session.registration}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Button variant="ghost" label={view.action} onPress={() => openLink(view.href)} testID="csca-open" />
    </Card>
  );
}
