import {
  PortalContactCard,
  PortalEmptyState,
  PortalMissingCase,
  PortalNotice,
  PortalPageHeader,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import type { StudentPortalContact } from "@/lib/contracts/student-portal";
import { getPortalPageData } from "@/lib/portal";

export default async function PortalTeamPage() {
  const { snapshot, locale, t } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  const contacts: Array<{ contact: StudentPortalContact; roleLabel: string }> = [];
  if (snapshot.manager) {
    contacts.push({ contact: snapshot.manager, roleLabel: copy.manager });
  }
  if (snapshot.curator && snapshot.curator.id !== snapshot.manager?.id) {
    contacts.push({ contact: snapshot.curator, roleLabel: copy.curator });
  }

  return (
    <>
      <PortalPageHeader title={copy.teamTitle} description={copy.teamDescription} />
      <div className={styles.stack}>
        {contacts.length === 0 ? (
          <PortalEmptyState icon="team" title={copy.noTeamTitle} body={copy.noTeamBody} />
        ) : (
          <section className={styles.teamCards} aria-label={copy.teamTitle}>
            {contacts.map(({ contact, roleLabel }) => (
              <PortalContactCard
                key={contact.id}
                contact={contact}
                roleLabel={roleLabel || t(`role.${contact.role}`)}
                copy={copy}
              />
            ))}
          </section>
        )}
        <PortalNotice title={copy.teamBoundaryTitle} body={copy.teamBoundaryBody} />
      </div>
    </>
  );
}
