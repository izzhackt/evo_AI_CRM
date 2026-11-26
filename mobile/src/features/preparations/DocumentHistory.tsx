// История документов: по одному требованию («История документа») и по всей программе («История всех документов программы»),
// страницами по двадцать. Читается при первом раскрытии. Веб: `ProgramDocumentHistory.tsx` (`ProgramHistoryEvidence`).
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import type { ApplicationDocumentHistoryEntry, ApplicationDocumentHistoryPage } from "@web/lib/portal/application-documents";

import { usePortalApi } from "@/api/PortalApi";
import { readDocumentHistory } from "@/api/preparations-documents";
import { Collapsible } from "@/features/preparations/Collapsible";
import { DeadlineBlock } from "@/features/preparations/DeadlineBlock";
import { usePreparation } from "@/features/preparations/context";
import { Block, FileFacts, SubmissionFacts } from "@/features/preparations/ItemDocumentState";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

/** Одна запись истории: определение требования на тот момент, сохранённый файл или отправленный документ с решением. */
export function HistoryEvidence({ entry, testID }: { entry: ApplicationDocumentHistoryEntry; testID?: string }) {
  const { strings, scope } = usePreparation();
  const origin = {
    studentCaseId: scope.studentCaseId,
    applicationId: scope.applicationId,
    requirementsRevisionId: entry.requirementsRevisionId,
    requirementItemId: entry.requirementItemId,
    documentSlotId: entry.definition.documentSlotId,
  };
  const { definition } = entry;
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <Text variant="body" bold accessibilityRole="header">
        {definition.label}
      </Text>
      <Text variant="caption" tone="text2">
        {definition.groupLabel} · {definition.required ? strings.required : strings.optional}
      </Text>
      {definition.instructions ? (
        <Text variant="secondary" tone="text2">
          {definition.instructions}
        </Text>
      ) : null}
      {definition.deadline ? <DeadlineBlock deadline={definition.deadline} heading={strings.deadline} verified={strings.deadlineVerified} sourceLabel={strings.deadlineSource} /> : null}
      {entry.upload ? (
        <Block heading={strings.savedFile}>
          <FileFacts file={entry.upload.file} strings={strings} target={origin} />
        </Block>
      ) : null}
      {entry.submission ? <SubmissionFacts submission={entry.submission} strings={strings} target={origin} /> : null}
    </View>
  );
}

export function DocumentHistory({ requirementItemId, testID }: {
  /** `null`: вся программа. */
  requirementItemId: string | null;
  testID?: string;
}) {
  const { strings, scope } = usePreparation();
  const { transport } = usePortalApi();
  const [page, setPage] = useState<ApplicationDocumentHistoryPage | null>(null);
  const [events, setEvents] = useState<readonly ApplicationDocumentHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);

  const load = useCallback(
    async (more: boolean) => {
      if (lock.current || (more && !page?.nextCursor)) return;
      lock.current = true;
      setBusy(true);
      setFailed(false);
      try {
        const result = await readDocumentHistory(transport, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementItemId }, more ? (page?.nextCursor ?? null) : null);
        setPage(result);
        setEvents((current) => (more ? [...current, ...result.events.filter((item) => !current.some((old) => old.id === item.id))] : result.events));
      } catch {
        setFailed(true);
        // Текст ошибки стоит с ролью «alert», а на iPhone она без объявления молчит.
        announce(strings.historyUnavailable);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [page, requirementItemId, scope.applicationId, scope.studentCaseId, strings.historyUnavailable, transport],
  );

  return (
    <Collapsible
      title={requirementItemId ? strings.history : strings.programHistory}
      testID={testID}
      onToggle={(open) => {
        if (open && !page && !lock.current) void load(false);
      }}
    >
      <View style={{ gap: 12 }} accessibilityState={{ busy }}>
        {busy && !events.length ? (
          <Text variant="secondary" tone="text2" accessibilityRole="progressbar" accessibilityLabel={strings.loading}>
            {strings.loading}
          </Text>
        ) : null}
        {failed ? (
          <Text variant="secondary" tone="error" accessibilityRole="alert" testID={testID ? `${testID}-error` : undefined}>
            {strings.historyUnavailable}
          </Text>
        ) : null}
        {page && !events.length ? (
          <Text variant="secondary" tone="text2" testID={testID ? `${testID}-empty` : undefined}>
            {strings.historyEmpty}
          </Text>
        ) : null}
        {events.map((entry) => (
          <HistoryEvidence key={entry.id} entry={entry} testID={testID ? `${testID}-entry-${entry.id}` : undefined} />
        ))}
        <View style={{ gap: 8 }}>
          {page?.nextCursor ? <Button variant="ghost" label={strings.historyMore} onPress={() => void load(true)} disabled={busy} testID={testID ? `${testID}-more` : undefined} /> : null}
          {page ? <Button variant="ghost" label={strings.refresh} onPress={() => void load(false)} disabled={busy} testID={testID ? `${testID}-refresh` : undefined} /> : null}
        </View>
      </View>
    </Collapsible>
  );
}
