import Link from "next/link";

import { PortalIcon } from "@/components/platform/portal/PortalIcon";
import {
  formatPortalDate,
  nextActionHref,
  PortalContactCard,
  PortalMissingCase,
  PortalPageHeader,
  PortalPanel,
  PortalStatusBadge,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import { getPortalPageData } from "@/lib/portal";

export default async function PortalOverviewPage() {
  const { snapshot, locale, t } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  const action = snapshot.nextAction;
  const actionSeverityLabel = action
    ? action.severity === "urgent"
      ? copy.urgent
      : action.severity === "warning"
        ? copy.warning
        : copy.normal
    : null;
  const primaryContact = snapshot.curator ?? snapshot.manager;
  const latestUpdate = snapshot.updates[0];
  const progressDegrees = Math.round((snapshot.progressPercent / 100) * 360);

  const actionContent = (
    <>
      <div className={styles.actionTop}>
        <span className={styles.actionLabel}>{copy.nextAction}</span>
        {action && actionSeverityLabel && (
          <PortalStatusBadge value={action.severity} label={actionSeverityLabel} />
        )}
      </div>
      <div className={styles.actionTitle}>
        {action ? action.detail : copy.noUrgentAction}
      </div>
      <div className={styles.actionMeta}>
        {action
          ? action.dueDate
            ? `${copy.due}: ${formatPortalDate(action.dueDate, locale)}`
            : t(action.labelKey)
          : copy.noUrgentActionBody}
      </div>
    </>
  );

  return (
    <>
      <PortalPageHeader title={copy.homeTitle} description={copy.homeDescription} />
      <div className={styles.overviewGrid}>
        <div className={styles.overviewMain}>
          <section className={`${styles.panel} ${styles.progressPanel}`}>
            <div
              className={styles.progressRing}
              style={{
                background: `conic-gradient(var(--portal-accent) 0deg ${progressDegrees}deg, #e7e9ed ${progressDegrees}deg 360deg)`,
              }}
              role="img"
              aria-label={`${copy.progressLabel}: ${snapshot.progressPercent}%`}
            >
              <span className={styles.progressRingInner}>{snapshot.progressPercent}%</span>
            </div>
            <div>
              <div className={styles.progressEyebrow}>{copy.progressLabel}</div>
              <div className={styles.progressStage}>
                {copy.stageLabel}: {t(`stage.${snapshot.client.stage}`)}
              </div>
              <div className={styles.progressMeta}>
                {[snapshot.client.targetCountry, snapshot.client.targetDegree].filter(Boolean).join(" · ") ||
                  copy.notAssigned}
              </div>
            </div>
          </section>

          {action ? (
            <Link href={nextActionHref(action)} className={styles.actionCard}>
              {actionContent}
            </Link>
          ) : (
            <section className={styles.actionCard}>{actionContent}</section>
          )}

          <PortalPanel title={copy.journey} className={styles.journey}>
            <ol className={styles.journeyList}>
              {snapshot.stageTimeline.map((item) => (
                <li
                  key={item.stage}
                  className={`${styles.journeyItem} ${
                    item.state === "complete" ? styles.journeyItemComplete : ""
                  }`}
                >
                  <span
                    className={`${styles.journeyDot} ${
                      item.state === "complete"
                        ? styles.journeyDotComplete
                        : item.state === "current"
                          ? styles.journeyDotCurrent
                          : ""
                    }`}
                  >
                    {item.state === "complete" ? (
                      <PortalIcon name="check" size={16} strokeWidth={2.2} />
                    ) : item.state === "current" ? (
                      <PortalIcon name="clock" size={17} />
                    ) : (
                      <PortalIcon name="clock" size={16} />
                    )}
                  </span>
                  <span className={styles.journeyLabel}>{t(item.labelKey)}</span>
                  <span className={styles.journeyState}>{t(`portalStage.${item.state}`)}</span>
                </li>
              ))}
            </ol>
          </PortalPanel>

          <nav aria-label={copy.quickLinks} className={styles.quickGrid}>
            {[
              { href: "/portal/visa", label: copy.visa, icon: "visa" as const },
              { href: "/portal/payments", label: copy.payments, icon: "payments" as const },
              { href: "/portal/team", label: copy.team, icon: "team" as const },
            ].map((item) => (
              <Link key={item.href} href={item.href} className={styles.quickLink}>
                <span>
                  <span className={styles.quickIcon}>
                    <PortalIcon name={item.icon} size={19} />
                  </span>
                  <span className={styles.quickText}>{item.label}</span>
                </span>
              </Link>
            ))}
          </nav>
        </div>

        <aside className={styles.overviewRail}>
          <PortalPanel
            title={copy.supportTeam}
            action={
              <Link href="/portal/team" className={styles.subtleLink}>
                {copy.viewAll}
              </Link>
            }
          >
            {primaryContact ? (
              <>
                <PortalContactCard
                  contact={primaryContact}
                  roleLabel={t(`role.${primaryContact.role}`)}
                  copy={copy}
                  compact
                />
                <div className={styles.teamActions}>
                  <a href={`mailto:${primaryContact.email}`} className={styles.buttonSecondary}>
                    <PortalIcon name="mail" size={16} />
                    {copy.write}
                  </a>
                </div>
              </>
            ) : (
              <p className={styles.cardMeta}>{copy.noTeamBody}</p>
            )}
          </PortalPanel>

          <PortalPanel
            title={copy.latestUpdate}
            action={
              <Link href="/portal/messages" className={styles.subtleLink}>
                {copy.viewAll}
              </Link>
            }
          >
            {latestUpdate ? (
              <>
                <div className={styles.updateText}>{latestUpdate.message}</div>
                <div className={styles.updateMeta}>
                  {latestUpdate.authorName ?? "EVO Admissions"} ·{" "}
                  {formatPortalDate(latestUpdate.createdAt, locale, true)}
                </div>
              </>
            ) : (
              <p className={styles.cardMeta}>{copy.noUpdates}</p>
            )}
          </PortalPanel>
        </aside>
      </div>
    </>
  );
}
