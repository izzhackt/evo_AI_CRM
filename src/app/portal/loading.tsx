import {
  PortalPageHeader,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import { getLocale } from "@/lib/i18n";

export default async function PortalLoading() {
  const locale = await getLocale();
  const copy = getPortalCopy(locale);

  return (
    <div aria-busy="true" aria-live="polite">
      <PortalPageHeader title={copy.loading} description={copy.loadingBody} />
      <div className={styles.loadingGrid} aria-hidden="true">
        <div className={`${styles.panel} ${styles.panelPadding} ${styles.stack}`}>
          <span className={`${styles.skeleton} ${styles.skeletonTitle}`} />
          <span className={`${styles.skeleton} ${styles.skeletonLine}`} />
          <span className={`${styles.skeleton} ${styles.skeletonLine}`} />
          <span className={`${styles.skeleton} ${styles.skeletonCard}`} />
        </div>
        <span className={`${styles.skeleton} ${styles.skeletonCard}`} />
      </div>
    </div>
  );
}
