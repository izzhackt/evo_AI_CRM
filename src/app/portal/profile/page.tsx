import { logoutAction } from "@/lib/actions";
import {
  PortalMissingCase,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { PortalIcon } from "@/components/platform/portal/PortalIcon";
import { PortalLanguageSwitcher } from "@/components/platform/portal/PortalLanguageSwitcher";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import { getPortalPageData } from "@/lib/portal";

export default async function PortalProfilePage() {
  const { snapshot, locale } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  return (
    <>
      <PortalPageHeader title={copy.profileTitle} description={copy.profileDescription} />
      <div className={styles.twoColumn}>
        <div className={styles.stack}>
          <PortalPanel title={copy.personalData}>
            <div className={styles.detailGrid}>
              <div>
                <div className={styles.detailLabel}>{copy.email}</div>
                <div className={styles.detailValue}>{snapshot.student.email}</div>
              </div>
              <div>
                <div className={styles.detailLabel}>{copy.phone}</div>
                <div className={styles.detailValue}>{snapshot.student.phone ?? copy.notAssigned}</div>
              </div>
            </div>
          </PortalPanel>
          <PortalNotice
            title={copy.profileReadOnlyTitle}
            body={copy.profileReadOnlyBody}
          />
        </div>

        <aside className={styles.stack}>
          <PortalPanel title={copy.security}>
            <div className={styles.personRow}>
              <span className={styles.cardIcon}>
                <PortalIcon name="shield" size={20} />
              </span>
              <p className={styles.cardMeta}>{copy.protectedSession}</p>
            </div>
            <div style={{ marginTop: 16 }}>
              <PortalNotice
                title={copy.passwordUnavailableTitle}
                body={copy.passwordUnavailableBody}
                tone="warning"
              />
            </div>
          </PortalPanel>

          <PortalPanel title={copy.language}>
            <PortalLanguageSwitcher current={locale} label={copy.language} />
          </PortalPanel>

          <form action={logoutAction}>
            <button type="submit" className={styles.logoutButton}>
              <PortalIcon name="log-out" size={17} />
              {copy.signOut}
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
