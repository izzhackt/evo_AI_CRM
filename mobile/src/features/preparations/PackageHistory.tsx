// «История комплектов»: отправленные комплекты программы от новых к старым, у каждого статус и «Открыть комплект».
// Читается при первом раскрытии, страницами по двадцать. Веб: `PackageHistory.tsx`.
import type { ApplicationDocumentCursor } from "@web/lib/portal/application-documents";
import type { ApplicationPackageSummary } from "@web/lib/portal/application-packages";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { readPackageHistory } from "@/api/preparations-packages";
import { Collapsible } from "@/features/preparations/Collapsible";
import { usePreparation } from "@/features/preparations/context";
import { programTime } from "@/features/preparations/model";
import { PackageDetailLoader, packageStatus } from "@/features/preparations/PackageDetail";
import type { PackageStrings } from "@/features/preparations/package-strings";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export function PackageHistory({ strings: t }: { strings: PackageStrings }) {
  const { scope } = usePreparation();
  const { transport } = usePortalApi();
  const [rows, setRows] = useState<readonly ApplicationPackageSummary[]>([]);
  const [cursor, setCursor] = useState<ApplicationDocumentCursor | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const load = useCallback(
    async (reset: boolean) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setFailed(false);
      try {
        const result = await readPackageHistory(transport, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }, reset ? null : cursor);
        setRows((old) => (reset ? [...result.packages] : [...old, ...result.packages.filter((row) => !old.some((value) => value.packageId === row.packageId))]));
        setCursor(result.nextCursor);
        setLoaded(true);
      } catch {
        setFailed(true);
        // Роль «alert» на iPhone молчит: сбой нужно сказать читалке самим.
        announce(t.unavailable);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [cursor, scope.applicationId, scope.studentCaseId, t.unavailable, transport],
  );
  return (
    <Collapsible title={t.history} testID="prep-package-history" onToggle={(open) => { if (open && !loaded && !lock.current) void load(true); }}>
      {busy && !rows.length ? <Text variant="secondary" tone="text2" accessibilityRole="progressbar" accessibilityLabel={t.loading}>{t.loading}</Text> : null}
      {failed ? <Text variant="secondary" tone="error" accessibilityRole="alert" testID="prep-package-history-error">{t.unavailable}</Text> : null}
      {loaded && !rows.length ? <Text variant="secondary" tone="text2" testID="prep-package-history-empty">{t.noHistory}</Text> : null}
      {rows.map((row) => (
        <View key={row.packageId} style={{ gap: 6 }} testID={`prep-package-row-${row.packageId}`}>
          <Text variant="body" bold>
            {t.version} {row.packageVersion} · {packageStatus(row, t)}
          </Text>
          <Text variant="caption" tone="text2">{programTime(row.submittedAt)}</Text>
          <Collapsible
            title={t.open}
            accessibilityLabel={`${t.open}: ${t.version} ${row.packageVersion}`}
            open={openId === row.packageId}
            onToggle={(open) => setOpenId(open ? row.packageId : null)}
            testID={`prep-package-open-${row.packageId}`}
          >
            <PackageDetailLoader packageId={row.packageId} />
          </Collapsible>
        </View>
      ))}
      <View style={{ gap: 8 }}>
        <Button variant="ghost" label={t.refresh} onPress={() => void load(true)} disabled={busy} testID="prep-package-history-refresh" />
        {cursor ? <Button variant="ghost" label={t.more} onPress={() => void load(false)} disabled={busy} testID="prep-package-history-more" /> : null}
      </View>
    </Collapsible>
  );
}
