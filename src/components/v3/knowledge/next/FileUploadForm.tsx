"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";

import { FILE_ACCEPT, MAX_FILE_BYTES, uploadConfirmed, type KnowledgeFile } from "../../FileManager";

type Outcome = "idle" | "sending" | "saved" | "invalid" | "forbidden" | "unavailable";

/** Загрузка файла в карточку документа компании: тот же адрес, поля и проверка ответа, что у прежней формы; итог словами. */
export function FileUploadForm({ file }: Readonly<{ file: KnowledgeFile }>) {
  const router = useRouter();
  const [state, setState] = useState<{ outcome: Outcome; message: string | null }>({ outcome: "idle", message: null });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file.version || !file.uploadRequestId) return setState({ outcome: "unavailable", message: "Загрузка недоступна." });
    const body = new FormData(event.currentTarget);
    const selected = body.get("file");
    if (!(selected instanceof File) || selected.size < 1 || selected.size > MAX_FILE_BYTES) return setState({ outcome: "invalid", message: "Выберите поддерживаемый файл размером до 25 МБ." });
    setState({ outcome: "sending", message: null });
    try {
      const response = await fetch(`/api/v3/company-files/${encodeURIComponent(file.id)}/versions`, { method: "POST", body });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && uploadConfirmed(payload, file)) { setState({ outcome: "saved", message: "Файл сохранён." }); router.refresh(); return; }
      if (response.status === 409) { setState({ outcome: "invalid", message: "Запись изменилась. Данные обновлены." }); router.refresh(); }
      else if (response.status === 400 || response.status === 413 || response.status === 415) setState({ outcome: "invalid", message: "Проверьте файл и обновите запись перед повтором." });
      else if (response.status === 401 || response.status === 403) setState({ outcome: "forbidden", message: "У вашей роли нет права загружать этот файл." });
      else setState({ outcome: "unavailable", message: "Хранилище не подтвердило загрузку." });
    } catch { setState({ outcome: "unavailable", message: "Хранилище не подтвердило загрузку." }); }
  }
  const locked = state.outcome === "sending" || state.outcome === "saved";
  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="v3-company-file-upload-form" aria-busy={state.outcome === "sending"}>
      <input type="hidden" name="expected_file_version" value={file.version ?? ""} />
      <input type="hidden" name="request_id" value={file.uploadRequestId ?? ""} />
      <div className="grid gap-1.5">
        <Label htmlFor={`upload-${file.id}`}>{file.currentVersionId ? "Заменить файл" : "Загрузить файл"}</Label>
        <Input id={`upload-${file.id}`} required type="file" name="file" accept={FILE_ACCEPT} disabled={locked} data-testid="v3-company-file-input" />
      </div>
      <div><button type="submit" className={QUEUE_CONFIRM} disabled={locked}>{state.outcome === "sending" ? "Загрузка…" : "Сохранить"}</button></div>
      {state.message ? (
        <p role="status" data-testid="v3-company-file-upload-status" data-outcome={state.outcome}
          className={`t-body-compact ${state.outcome === "saved" ? "text-ok" : state.outcome === "invalid" ? "text-warn" : "text-danger"}`}>{state.message}</p>
      ) : null}
    </form>
  );
}
