// «Незавершённые отправки на этом устройстве»: комплект, который не удалось подтвердить. Студент проверяет результат
// («Проверить результат») или повторяет сохранённое действие тем же запросом («Повторить сохранённое действие»). Веб:
// `PackageRecovery.tsx` (запись программы и страница всех программ владельца).
import type { ApplicationPackageSubmitIntent } from "@web/lib/portal/application-packages";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { readDocumentHistory } from "@/api/preparations-documents";
import { recoverApplicationPackage, submitApplicationPackage } from "@/api/preparations-packages";
import { packageCommandFailure, runPackageCommand } from "@/features/preparations/package-commands";
import { go } from "@/features/portal/navigation";
import { packagesPending } from "@/features/preparations/packages-pending";
import { usePackageStrings, type PackageStrings } from "@/features/preparations/package-strings";
import type { PendingScope } from "@/features/preparations/pending-store";
import { preparationPath } from "@/features/preparations/routes";
import { usePackagePending } from "@/features/preparations/use-package-pending";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

type FrozenFile = Readonly<{ label: string; filename: string; version: string }>;

/** Одна неоконченная отправка комплекта: что в ней, «Проверить результат», «Повторить сохранённое действие». */
function RecoveryEntry({ scope, intent, strings: t, onSaved, historyLink }: { scope: PendingScope; intent: ApplicationPackageSubmitIntent; strings: PackageStrings; onSaved: (message?: string) => void; historyLink: boolean }) {
  const { transport } = usePortalApi();
  const [files, setFiles] = useState<readonly FrozenFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const submit = useCallback((value: ApplicationPackageSubmitIntent) => submitApplicationPackage(transport, value), [transport]);
  const recover = useCallback((value: ApplicationPackageSubmitIntent) => recoverApplicationPackage(transport, value), [transport]);

  /** Загрузить состав записанного запроса по истории документов: имена файлов и версии, как они были выбраны. */
  async function preview() {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const rows = await Promise.all(
        intent.items.map(async (item) => {
          const page = await readDocumentHistory(transport, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementItemId: item.requirementItemId });
          const event = page.events.find((entry) => entry.requirementsRevisionId === intent.requirementsRevisionId && (entry.upload?.file ?? entry.submission?.file)?.documentVersionId === item.selection.documentVersionId);
          const file = event?.upload?.file ?? event?.submission?.file;
          if (!event || !file) throw new Error("frozen file unavailable");
          return { label: event.definition.label, filename: file.originalFilename, version: file.versionNo };
        }),
      );
      setFiles(rows);
    } catch {
      setFiles(null);
      setMessage(t.unavailable);
      announce(t.unavailable);
    } finally {
      setLoading(false);
    }
  }

  async function run(checkOnly: boolean) {
    if (lock.current || (!checkOnly && !files)) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runPackageCommand({ scope, intent, checkOnly, submit, recover });
      if (result.kind === "committed" || result.kind === "not_written") {
        const confirmed = `${result.kind === "not_written" ? t.notWritten : t.sent}${result.cleared ? "" : ` ${t.cleanup}`}`;
        setMessage(confirmed);
        announce(confirmed);
        onSaved(confirmed);
      } else {
        const failure = packageCommandFailure(result, t);
        setMessage(failure);
        announce(failure);
      }
    } catch {
      setMessage(t.pending);
      announce(t.pending);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }} accessibilityState={{ busy: busy || loading }} testID={`prep-recovery-package-${intent.requestId}`}>
      <Text variant="body" bold accessibilityRole="header">
        {t.frozen}
      </Text>
      <Text variant="secondary">{t.pending}</Text>
      {files ? (
        files.map((file, index) => (
          <View key={index} style={{ gap: 2 }}>
            <Text variant="body">{file.label}</Text>
            <Text variant="secondary" bold>{file.filename}</Text>
            <Text variant="caption" tone="text2">{t.fileVersion} {file.version}</Text>
          </View>
        ))
      ) : (
        <View style={{ gap: 6 }}>
          <Text variant="secondary" tone="text2">{t.frozenUnavailable}</Text>
          <Button variant="ghost" label={loading ? t.loading : t.previewTitle} onPress={() => void preview()} disabled={busy || loading} testID={`prep-recovery-preview-${intent.requestId}`} />
        </View>
      )}
      <View style={{ gap: 8 }}>
        <Button variant="ghost" label={t.checkResult} onPress={() => void run(true)} disabled={busy || loading} testID={`prep-recovery-check-${intent.requestId}`} />
        <Button label={busy ? t.submitting : t.retry} onPress={() => void run(false)} disabled={busy || loading || !files} testID={`prep-recovery-retry-${intent.requestId}`} />
        {historyLink ? <Button variant="ghost" label={t.allHistory} onPress={() => go(preparationPath(scope.applicationId))} testID={`prep-recovery-history-${intent.requestId}`} /> : null}
      </View>
      {message ? <Text variant="secondary" testID={`prep-recovery-message-${intent.requestId}`}>{message}</Text> : null}
    </View>
  );
}

/** Неоконченные отправки комплекта одной программы. Ничего не показывает, пока их нет. */
export function PackageRecovery({ scope, onSaved, historyLink = false }: {
  scope: PendingScope;
  onSaved: (message?: string) => void;
  /** «Открыть историю программы» (веб показывает ссылку и на самой странице программы; в приложении она нужна только на странице всех программ). */
  historyLink?: boolean;
}) {
  const t = usePackageStrings();
  const [notice, setNotice] = useState<string | null>(null);
  const pending = usePackagePending(scope);
  const saved = (message?: string) => {
    if (message) setNotice(message);
    onSaved(message);
  };
  return (
    <View style={{ gap: 12 }}>
      {notice ? <Text variant="secondary" tone="text2" testID="prep-recovery-notice">{notice}</Text> : null}
      {pending.hydrated && (pending.blocked || pending.entries.length > 0) ? (
        <View style={{ gap: 12 }} testID="prep-package-recovery">
          <Text variant="heading" accessibilityRole="header">
            {t.pendingTitle}
          </Text>
          {pending.blocked ? <Text variant="secondary" tone="error" accessibilityRole="alert">{t.storage}</Text> : null}
          {pending.entries.map((entry) =>
            entry.blocked || !entry.intent ? (
              <Text key={`${entry.operation}:${entry.target}`} variant="secondary" tone="error" accessibilityRole="alert">
                {t.storage}
              </Text>
            ) : (
              <RecoveryEntry key={entry.intent.requestId} scope={scope} intent={entry.intent} strings={t} onSaved={saved} historyLink={historyLink} />
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Программы владельца с неоконченными отправками комплекта (по ключам хранилища). `blocked`: хранилище не читается. */
export function usePendingPackageScopes(): Readonly<{ state: "hydrating" | "blocked" | "ready"; scopes: readonly PendingScope[] }> {
  const { organizationId, membershipId } = usePortalApi();
  const key = `${organizationId}:${membershipId}`;
  const [read, setRead] = useState<{ key: string; blocked: boolean; scopes: readonly PendingScope[] } | null>(null);
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const load = () => {
      const mine = ++sequence;
      packagesPending.scopes({ organizationId, membershipId }).then(
        (scopes) => {
          if (alive && mine === sequence) setRead({ key, blocked: false, scopes });
        },
        () => {
          if (alive && mine === sequence) setRead({ key, blocked: true, scopes: [] });
        },
      );
    };
    load();
    const off = packagesPending.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [key, organizationId, membershipId]);
  if (!read || read.key !== key) return { state: "hydrating", scopes: [] };
  return { state: read.blocked ? "blocked" : "ready", scopes: read.scopes };
}

/**
 * Страница «Незавершённые отправки»: по программам владельца. Итог «подтверждено» держится здесь, а не в строке программы:
 * после подтверждения запись снимается, программа пропадает из списка, и её собственное сообщение исчезло бы вместе с ней.
 */
export function PackageOwnerRecovery({ renderScope, showEmpty = false, onSaved }: {
  renderScope: (scope: PendingScope, onSaved: (message?: string) => void) => ReactNode;
  showEmpty?: boolean;
  onSaved?: (message?: string) => void;
}) {
  const t = usePackageStrings();
  const { state, scopes } = usePendingPackageScopes();
  const [notice, setNotice] = useState<string | null>(null);
  const saved = (message?: string) => {
    if (message) setNotice(message);
    onSaved?.(message);
  };
  return (
    <View style={{ gap: 16 }}>
      {notice ? (
        <Text variant="secondary" tone="text2" testID="prep-recovery-owner-notice">
          {notice}
        </Text>
      ) : null}
      {state === "blocked" ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID="prep-recovery-storage">
          {t.storage}
        </Text>
      ) : state === "hydrating" ? (
        showEmpty ? (
          <Text variant="secondary" tone="text2" accessibilityRole="progressbar" accessibilityLabel={t.loading}>
            {t.loading}
          </Text>
        ) : null
      ) : (
        <>
          {showEmpty && scopes.length === 0 ? (
            <Text variant="secondary" tone="text2" testID="prep-recovery-empty">
              {t.noPending}
            </Text>
          ) : null}
          {scopes.map((scope) => (
            <View key={`${scope.studentCaseId}:${scope.applicationId}`}>{renderScope(scope, saved)}</View>
          ))}
        </>
      )}
    </View>
  );
}
