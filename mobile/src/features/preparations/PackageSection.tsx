// «Комплект программы»: выбрать файлы для комплекта, «Проверить состав», «Отправить комплект в EVO», «Открыть комплект»,
// «История комплектов» и неоконченные отправки. Веб: `PackagePreparation.tsx` (студент). Состав проверяет сервер
// (`application_package_readiness_v1` с выбором), отправка идёт только из последнего такого ответа, а не из черновика выбора.
import { buildApplicationPackageSubmitIntent } from "@web/lib/portal/application-package-ui";
import type { ApplicationPackageReadiness, ApplicationPackageSelection } from "@web/lib/portal/application-packages";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { readApplicationReadiness } from "@/api/preparations-reads";
import { recoverApplicationPackage, submitApplicationPackage } from "@/api/preparations-packages";
import { FileFacts } from "@/features/preparations/ItemDocumentState";
import { PackageDetailLoader, packageStatus } from "@/features/preparations/PackageDetail";
import { PackageHistory } from "@/features/preparations/PackageHistory";
import { PackageRecovery } from "@/features/preparations/PackageRecovery";
import { PackageSelectionRow } from "@/features/preparations/PackageSelectionRow";
import { usePreparation } from "@/features/preparations/context";
import { programTime } from "@/features/preparations/model";
import { packageCommandFailure, runPackageCommand } from "@/features/preparations/package-commands";
import { usePackageStrings, type PackageStrings } from "@/features/preparations/package-strings";
import { usePackagePending } from "@/features/preparations/use-package-pending";
import { RpcError } from "@/lib/rpc";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Collapsible } from "@/features/preparations/Collapsible";
import { Text } from "@/ui/Text";

/** Причина неготовности комплекта -> строка словаря (веб: `readyReason`). */
export function readyReasonText(reason: string, t: PackageStrings): string {
  switch (reason) {
    case "empty_composition":
      return t.empty;
    case "missing_required":
      return t.missing;
    case "file_unavailable":
      return t.fileUnavailable;
    case "material_unavailable":
      return t.materialUnavailable;
    case "previous_submission_changed":
      return t.changed;
    default:
      return t.unavailable;
  }
}

/** Выбор файлов относится к одной программе: смена программы или участника начинает с чистого состояния (веб: `key={packageScopeKey(scope)}`). */
export function PackageSection(props: PackageSectionProps) {
  const { scope } = usePreparation();
  return <PackageState key={`${scope.organizationId}:${scope.membershipId}:${scope.studentCaseId}:${scope.applicationId}`} {...props} />;
}

type PackageSectionProps = {
  /** Свежий ответ программы; `null`: чтение не удалось. */
  readiness: ApplicationPackageReadiness | null;
  /** Идёт чтение или запись требований: выбор закрыт, пока ответ не пришёл (веб: `loading={busy !== null}`). */
  loading: boolean;
};

function PackageState({ readiness, loading }: PackageSectionProps) {
  const { scope, strings: documentStrings, onSaved, epoch } = usePreparation();
  const t = usePackageStrings();
  const api = usePortalApi();
  const { tokens } = useTheme();
  const [choices, setChoices] = useState<Record<string, ApplicationPackageSelection>>({});
  const [optional, setOptional] = useState<readonly string[]>([]);
  const [selectionRevision, setSelectionRevision] = useState<string | null>(null);
  const [selectionLabels, setSelectionLabels] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ value: ApplicationPackageReadiness; epoch: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const lock = useRef(false);
  const pending = usePackagePending(scope);

  // Выбор сделан по одним требованиям, а сервер уже читает другие: прежний выбор показан и сбрасывается только с подтверждением.
  const revisionChanged = Boolean(selectionRevision) && Boolean(readiness) && selectionRevision !== readiness?.requirements.revisionId && (Object.keys(choices).length > 0 || optional.length > 0);
  const missingOptional = readiness?.requirements.items.filter((item) => !item.required && optional.includes(item.requirementItemId) && !choices[item.requirementItemId]) ?? [];
  const blocked = !pending.hydrated || pending.blocked || pending.entries.length > 0 || busy || loading;
  // Комплект отправляется только из ответа, прочитанного в этом же показе: после обновления программы предпросмотр снимается.
  const shown = !revisionChanged && preview?.epoch === epoch ? preview.value : null;
  const choicesForCurrent = readiness?.requirements.items.flatMap((item) => ((item.required || optional.includes(item.requirementItemId)) && choices[item.requirementItemId] ? [choices[item.requirementItemId]!] : [])) ?? [];
  const edit = () => {
    setPreview(null);
    setSuccess(false);
    setMessage(null);
  };

  async function prepare() {
    if (lock.current || blocked || !readiness || revisionChanged || missingOptional.length) return;
    lock.current = true;
    setBusy(true);
    setPreview(null);
    setMessage(null);
    setSuccess(false);
    const startEpoch = epoch;
    try {
      const value = await readApplicationReadiness(api.transport, scope.studentCaseId, scope.applicationId, choicesForCurrent);
      setPreview({ value, epoch: startEpoch });
      // Веб переносит фокус на заголовок проверки; в приложении его читает вслух читалка вместе с готовностью.
      announce(value.canSubmit ? `${t.previewTitle}. ${t.ready}` : t.previewTitle);
    } catch (error) {
      const text = error instanceof RpcError && error.kind === "forbidden" ? t.forbidden : t.unavailable;
      setMessage(text);
      announce(text);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function submit() {
    if (lock.current || blocked || !shown) return;
    const intent = buildApplicationPackageSubmitIntent(shown, randomUUID());
    if (!intent) {
      setMessage(t.changed);
      announce(t.changed);
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setSuccess(false);
    try {
      const result = await runPackageCommand({
        scope,
        intent,
        checkOnly: false,
        submit: (value) => submitApplicationPackage(api.transport, value),
        recover: (value) => recoverApplicationPackage(api.transport, value),
      });
      if (result.kind === "committed") {
        const text = result.cleared ? t.sent : `${t.sent} ${t.cleanup}`;
        setSuccess(true);
        setMessage(text);
        announce(text);
        if (result.proof.status === "committed" && "packageVersion" in result.proof.receipt) {
          setSavedId(result.proof.receipt.packageId);
          setSentAt(result.proof.receipt.submittedAt);
        }
        setPreview(null);
        onSaved();
      } else {
        const text = packageCommandFailure(result, t);
        setMessage(text);
        announce(text);
      }
    } catch {
      setMessage(t.pending);
      announce(t.pending);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function saved(text?: string) {
    if (text) {
      setMessage(text);
      setSuccess(true);
    }
    onSaved();
  }

  const openTarget = savedId ?? readiness?.latestPackage?.packageId ?? null;
  return (
    <View style={{ gap: 12 }} accessibilityLabel={t.title} testID="prep-package-section">
      <PackageRecovery scope={scope} onSaved={saved} />
      <Text variant="heading" accessibilityRole="header">
        {t.title}
      </Text>
      {revisionChanged ? (
        <View accessibilityRole="alert" style={{ gap: 8 }} testID="prep-package-revision-changed">
          <Text variant="secondary">{t.revisionChanged}</Text>
          {Object.entries(selectionLabels).map(([id, label]) => (
            <Text key={id} variant="secondary" tone="text2">
              • {label}
            </Text>
          ))}
          <Button
            variant="ghost"
            label={t.resetSelection}
            disabled={blocked}
            testID="prep-package-reset"
            onPress={() => {
              setChoices({});
              setOptional([]);
              setSelectionLabels({});
              setSelectionRevision(readiness?.requirements.revisionId ?? null);
              edit();
            }}
          />
        </View>
      ) : null}
      {readiness?.latestPackage ? (
        <Text variant="secondary" tone="text2" testID="prep-package-latest">
          {packageStatus(readiness.latestPackage, t)} · {t.version} {readiness.latestPackage.packageVersion}
        </Text>
      ) : null}
      {readiness?.requirements.origin === "evo_starter" ? (
        <>
          <Text variant="secondary" tone="text2">{t.starter}</Text>
          <Text variant="secondary" tone="text2">{t.starterHelp}</Text>
        </>
      ) : null}
      {loading ? (
        <Text variant="secondary" tone="text2" accessibilityRole="progressbar" accessibilityLabel={t.loading}>
          {t.loading}
        </Text>
      ) : !readiness ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID="prep-package-unavailable">
          {t.unavailable}
        </Text>
      ) : (
        <Collapsible title={t.choose} open={choosing} onToggle={setChoosing} testID="prep-package-choose">
          {!shown ? (
            <View style={{ gap: 8 }}>
              {readiness.requirements.items.map((item) => {
                const state = readiness.documentItems.find((value) => value.requirementItemId === item.requirementItemId);
                if (!state) return null;
                const remember = () => {
                  edit();
                  setSelectionRevision(readiness.requirements.revisionId);
                  setSelectionLabels((old) => ({ ...old, [item.requirementItemId]: item.label }));
                };
                return (
                  <PackageSelectionRow
                    key={`${item.requirementItemId}:${epoch}`}
                    item={item}
                    state={state}
                    selected={choices[item.requirementItemId]}
                    included={item.required || optional.includes(item.requirementItemId)}
                    disabled={blocked || revisionChanged}
                    strings={t}
                    onInclude={(included) => {
                      remember();
                      setOptional((old) => (included ? [...old, item.requirementItemId] : old.filter((value) => value !== item.requirementItemId)));
                    }}
                    onChange={(selection) => {
                      remember();
                      setChoices((old) => {
                        const next = { ...old };
                        if (selection) next[item.requirementItemId] = selection;
                        else delete next[item.requirementItemId];
                        return next;
                      });
                    }}
                  />
                );
              })}
              {missingOptional.length ? (
                <View accessibilityRole="alert" style={{ gap: 2 }}>
                  <Text variant="secondary">{t.optionalNeedsFile}</Text>
                  {missingOptional.map((item) => (
                    <Text key={item.requirementItemId} variant="secondary" tone="text2">
                      • {item.label}
                    </Text>
                  ))}
                </View>
              ) : null}
              <Button
                label={busy ? t.loading : t.preview}
                onPress={() => void prepare()}
                disabled={blocked || revisionChanged || missingOptional.length > 0 || !readiness.requirements.revisionId}
                testID="prep-package-preview"
              />
            </View>
          ) : (
            <View style={{ gap: 10 }} testID="prep-package-preview-box">
              <Text variant="heading" accessibilityRole="header" accessible>
                {t.previewTitle}
              </Text>
              {shown.selections.map((item) => {
                const requirement = shown.requirements.items.find((value) => value.requirementItemId === item.requirementItemId);
                return (
                  <View key={item.requirementItemId} style={{ gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: tokens.line }} testID={`prep-package-chosen-${item.requirementItemId}`}>
                    <Text variant="body" bold accessibilityRole="header">
                      {requirement?.label ?? t.document}
                    </Text>
                    {item.file && requirement && shown.requirements.revisionId ? (
                      <FileFacts
                        file={item.file}
                        strings={documentStrings}
                        target={{ studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementsRevisionId: shown.requirements.revisionId, requirementItemId: item.requirementItemId, documentSlotId: requirement.documentSlotId }}
                      />
                    ) : null}
                    {item.reasons.map((reason) => (
                      <Text key={reason} variant="secondary" tone="error">
                        {readyReasonText(reason, t)}
                      </Text>
                    ))}
                  </View>
                );
              })}
              {shown.missingRequiredItemIds.length ? (
                <View style={{ gap: 2 }}>
                  <Text variant="secondary">{t.missing}</Text>
                  {shown.missingRequiredItemIds.map((id) => (
                    <Text key={id} variant="secondary" tone="text2">
                      • {shown.requirements.items.find((item) => item.requirementItemId === id)?.label ?? t.document}
                    </Text>
                  ))}
                </View>
              ) : null}
              {shown.reasons
                .filter((reason) => reason !== "missing_required" || shown.missingRequiredItemIds.length === 0)
                .map((reason) => (
                  <Text key={reason} variant="secondary" tone="text2">
                    {readyReasonText(reason, t)}
                  </Text>
                ))}
              {shown.canSubmit ? (
                <Text variant="secondary" tone="text2" testID="prep-package-ready">
                  {t.ready}
                </Text>
              ) : null}
              <View style={{ gap: 8 }}>
                <Button label={busy ? t.submitting : t.submit} onPress={() => void submit()} disabled={blocked || !shown.canSubmit} testID="prep-package-submit" />
                <Button variant="ghost" label={t.edit} onPress={edit} disabled={blocked} testID="prep-package-edit" />
              </View>
            </View>
          )}
        </Collapsible>
      )}
      {message && success ? (
        <Text variant="secondary" tone="text2" testID="prep-package-message">
          {message}
          {sentAt ? ` · ${programTime(sentAt)}` : ""}
        </Text>
      ) : null}
      {message && !success ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID="prep-package-error">
          {message}
        </Text>
      ) : null}
      {openTarget ? (
        <Collapsible title={t.open} open={Boolean(opened)} onToggle={(open) => setOpened(open ? openTarget : null)} testID="prep-package-open">
          {opened ? <PackageDetailLoader packageId={opened} /> : null}
        </Collapsible>
      ) : null}
      <PackageHistory key={epoch} strings={t} />
    </View>
  );
}
