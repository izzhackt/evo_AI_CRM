// «Сообщить об ошибке» в задании (контракт §10): до 500 знаков, без имени, не больше 20 в сутки.
// Запрос замораживается один раз на отправку: повтор после обрыва идёт с тем же p_request_id.
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, View } from "react-native";

import { reportWrite, sendReport, cscaFailure } from "@/features/learning/csca/api";
import { usePortalApi } from "@/api/PortalApi";
import { useLang } from "@/i18n/LangProvider";
import type { FrozenWrite } from "@/lib/rpc";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { Text } from "@/ui/Text";

/** Текст 1..500 знаков после обрезки, без управляющих символов (перевод строки можно). */
export function normalizeReportText(raw: string): string | null {
  const text = raw.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/gu, "").trim();
  return text.length >= 1 && text.length <= 500 ? text : null;
}

export function ReportSheet({ itemKey, visible, onClose }: { itemKey: string; visible: boolean; onClose: () => void }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const { transport } = usePortalApi();
  const c = t("csca");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "limit" | "failed" | "empty">("idle");
  const frozen = useRef<{ text: string; write: FrozenWrite } | null>(null);

  async function send() {
    const normalized = normalizeReportText(text);
    if (!normalized) return setStatus("empty");
    // Тот же текст после сбоя: тот же запрос; изменённый текст это новое сообщение.
    if (frozen.current?.text !== normalized) frozen.current = { text: normalized, write: reportWrite(itemKey, normalized) };
    setStatus("sending");
    try {
      await sendReport(transport, frozen.current.write);
      frozen.current = null;
      setText("");
      setStatus("sent");
    } catch (error) {
      setStatus(cscaFailure(error) === "report_limit" ? "limit" : "failed");
    }
  }

  const message = status === "sent" ? c.reportSent : status === "limit" ? c.reportLimit : status === "failed" ? c.reportFailed : status === "empty" ? c.reportEmpty : null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <View style={{ backgroundColor: tokens.surface, padding: 16, gap: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 }} testID="report-sheet">
          <Text variant="heading" accessibilityRole="header">
            {c.reportOpen}
          </Text>
          <TextField label={c.reportLabel} hint={c.reportHint} value={text} onChangeText={(v) => { setText(v.slice(0, 500)); if (status !== "sending") setStatus("idle"); }} multiline maxLength={500} testID="report-input" />
          {message ? (
            <Text variant="secondary" tone={status === "sent" ? "ok" : "error"} accessibilityRole="alert" testID="report-status">
              {message}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label={status === "sending" ? c.reportSending : c.reportSend} onPress={() => void send()} busy={status === "sending"} disabled={status === "sent"} testID="report-send" style={{ flex: 1 }} />
            <Button variant="ghost" label={c.reportCancel} onPress={() => { setStatus("idle"); onClose(); }} testID="report-cancel" style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
