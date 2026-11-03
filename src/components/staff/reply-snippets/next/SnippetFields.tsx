import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PlatformReplySnippetAudience } from "@/lib/platform-reply-snippets";

import { ACTION_MESSAGES, AUDIENCE_LABELS } from "../KnowledgeReplySnippetSection";
import type { PlatformReplySnippetActionState } from "@/lib/platform-reply-snippet-actions";

/** Три поля шаблона — те же имена (`audience`, `title`, `body`), что у прежних форм: действия читают их по имени. */
export function SnippetFields({ audiences, disabled, defaults }: Readonly<{
  audiences: readonly PlatformReplySnippetAudience[];
  disabled: boolean;
  defaults?: Readonly<{ audience: PlatformReplySnippetAudience; title: string; body: string }>;
}>) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="snippet-title">Название</Label>
        <Input id="snippet-title" name="title" required autoComplete="off" disabled={disabled} defaultValue={defaults?.title} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="snippet-body">Текст ответа</Label>
        <Textarea id="snippet-body" name="body" required rows={6} disabled={disabled} defaultValue={defaults?.body} className="min-h-32" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="snippet-audience">Кому доступен</Label>
        <NativeSelect id="snippet-audience" name="audience" disabled={disabled} defaultValue={defaults?.audience}>
          {audiences.map((audience) => <option key={audience} value={audience}>{AUDIENCE_LABELS[audience]}</option>)}
        </NativeSelect>
      </div>
    </>
  );
}

/** Итог действия: «Сохранено» — спокойно, расхождение версий — предупреждение, остальное — проблема (слова те же, что раньше). */
export function SnippetFeedback({ state }: Readonly<{ state: PlatformReplySnippetActionState }>) {
  if (state.status === "idle") return null;
  const tone = state.status === "saved" ? "text-fg-2" : state.status === "stale" || state.status === "request_conflict" ? "text-warn" : "text-danger";
  return <p role={state.status === "saved" ? "status" : "alert"} className={`t-body-compact ${tone}`}>{ACTION_MESSAGES[state.status]}</p>;
}
