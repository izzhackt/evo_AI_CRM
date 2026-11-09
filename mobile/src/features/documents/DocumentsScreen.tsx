// Документы: чек-лист студента, загрузка и скачивание, «Договор и чеки».
// Образец: src/app/(portal)/portal/documents/page.tsx и DocumentsView.tsx (веб).
// Целевое устройство по #1361: вход загрузки только в строке документа, пустой список
// ведёт к чату («Написать EVO»), а не в тупик.
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Linking, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useCaseFiles, useDocuments, useRefetchOnFocus } from "@/api/queries";
import { documentProgress, documentProgressCounts } from "@/domain/documents-model";
import { CaseFilesCard } from "@/features/documents/CaseFilesCard";
import { DocumentRow } from "@/features/documents/DocumentRow";
import { nativeDocumentsIo, type DocumentsIo } from "@/features/documents/io";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, EmptyBlock, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const PRIVACY_URL = "https://evoadmissions.com/ru/privacy/";

function counterColor(kind: string, tokens: ReturnType<typeof useTheme>["tokens"]): string {
  return kind === "approved" ? tokens.ok : kind === "submitted" ? tokens.text : kind === "correction" ? tokens.warn : tokens.text2;
}

export function DocumentsScreen({ io = nativeDocumentsIo }: { io?: DocumentsIo }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  useRefetchOnFocus();
  const strings = t("admission");
  const documents = useDocuments();
  const caseFiles = useCaseFiles();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);

  const list = documents.data;
  const approved = list ? documentProgress(list).approved : 0;
  const counts = list ? documentProgressCounts(list, strings) : [];

  return (
    <Screen topInset={false} tabBar onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: 16 }} testID="documents-screen">
        <View style={{ gap: 4 }}>
          <Text variant="display" accessibilityRole="header" maxFontSizeMultiplier={1.2} testID="title-documents">
            {strings.documentsTitle}
          </Text>
          <Text variant="secondary" tone="text2">
            {strings.documentsLead}
          </Text>
        </View>

        {list === undefined ? (
          documents.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(documents.error))} retryLabel={m("gate.retry")} onRetry={() => void documents.refetch()} testID="documents-error" />
          ) : (
            <Card>
              <CardSkeleton label={`${strings.checklistHeading}. ${m("state.loading")}`} lines={4} />
            </Card>
          )
        ) : list.length === 0 ? (
          <Card>
            <EmptyBlock
              icon={FileText}
              title={strings.documentsEmptyTitle}
              body={strings.documentsEmptyBody}
              action={<Button variant="ghost" label={m("docs.emptyAction")} onPress={() => go("/messages/chat")} testID="documents-empty-action" />}
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardHead title={strings.checklistHeading} />
              <Text variant="title" testID="checklist-share" accessibilityLabel={`${strings.acceptedLabel} ${format(strings.acceptedShare, { approved: String(approved), total: String(list.length) })}`}>
                {strings.acceptedLabel} {format(strings.acceptedShare, { approved: String(approved), total: String(list.length) })}
              </Text>
              <Text variant="secondary" tone="text2">
                {strings.uploadHint}
              </Text>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: tokens.skeleton }}>
                {counts.map((item) => (
                  <View key={item.kind} style={{ flexGrow: item.count, backgroundColor: counterColor(item.kind, tokens) }} />
                ))}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 2 }}>
                {counts.map((item) => (
                  <Text key={item.kind} variant="caption" tone="text2">
                    {item.label}: <Text variant="caption" bold>{item.count}</Text>
                  </Text>
                ))}
              </View>
            </Card>
            <Card>
              <View testID="checklist">
                {list.map((document, index) => (
                  <DocumentRow key={document.documentSlotId} document={document} io={io} first={index === 0} />
                ))}
              </View>
            </Card>
            <Text variant="caption" tone="text2" testID="documents-privacy" onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)} accessibilityRole="link">
              {strings.documentsPrivacyNote} <Text variant="caption" tone="accent" bold>{strings.documentsPrivacyLink}</Text>
            </Text>
          </>
        )}

        {caseFiles.data ? <CaseFilesCard files={caseFiles.data} io={io} /> : null}
      </View>
    </Screen>
  );
}
