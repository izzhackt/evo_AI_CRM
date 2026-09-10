import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readPartnerPackets } from "@/lib/v3/case-operations-source";
import { DownloadPacketManifest, PreparePartnerPacketForm } from "./CaseOperationsForms";

export async function PartnerPacketsPanel({ actor, caseId, active, applications }: { actor: ActivePlatformActor; caseId: string; active: boolean; applications: readonly { id: string; name: string }[] }) {
  const workspace = await readPartnerPackets(actor, caseId).catch(() => null);
  return <details className="rounded-card border border-border bg-surface p-4 sm:p-5" id="partner-packets"><summary className="min-h-11 cursor-pointer font-semibold text-fg">Пакеты документов партнёру</summary>
    <p className="my-3 text-sm leading-6 text-fg-2">Состав фиксируется с версиями файлов. Подготовка не означает отправку партнёру или подачу в университет.</p>
    {!workspace ? <p role="alert" className="text-sm text-danger">Не удалось загрузить пакеты. Обновите дело; файлы не изменены.</p> : <div className="space-y-5">
      {active ? <PreparePartnerPacketForm caseId={caseId} files={workspace.files} applications={applications} /> : <p className="text-sm text-fg-3">Новые пакеты готовятся только в активном деле. История доступна ниже.</p>}
      <div><h4 className="font-medium text-fg">Последние 20 пакетов</h4>{!workspace.packets.length ? <p className="mt-2 text-sm text-fg-3">Пакеты ещё не подготовлены.</p> : <ul className="mt-3 space-y-3">{workspace.packets.map(packet => <li key={packet.id} className="rounded-ctl border border-border p-3"><details><summary className="min-h-11 cursor-pointer text-sm font-medium text-fg">{packet.applicationName} · {new Date(packet.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })}</summary>
        <p className="my-2 text-xs text-fg-3">Подготовил: {packet.createdBy}. ID: {packet.id}</p><DownloadPacketManifest packet={packet} />
        <ul className="mt-3 divide-y divide-border">{packet.files.map(file => <li key={file.versionId} className="py-3 text-sm"><p className="break-words text-fg">{file.name} · версия {file.versionNo}</p><a className="inline-flex min-h-11 items-center font-medium text-accent-text underline" href={`/api/v2/document-versions/${file.versionId}/download`}>Скачать эту версию</a></li>)}</ul>
        <p className="text-xs leading-5 text-fg-3">Каждая загрузка повторно проверяет доступ и безопасность файла. Пакет не публикуется по открытой ссылке.</p>
      </details></li>)}</ul>}</div>
    </div>}
  </details>;
}
