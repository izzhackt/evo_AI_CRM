"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Switch } from "@/components/ui/switch";
import { leadTestAction, type LeadTestActionState } from "@/lib/platform-lead-test-actions";
import { leadTestWords } from "@/lib/v3/wording";

/**
 * «Тестовый лид» (миграция 385): переключатель в «Данных лида». Включённое состояние — только по квитанции базы; неизвестный
 * исход оставляет тот же request id (повтор не запишет дважды). Без права — закрытый переключатель со словами, почему.
 */
export function LeadTestToggle({
  leadId,
  initialIsTest,
  requestId,
  readOnly,
}: Readonly<{ leadId: string; initialIsTest: boolean; requestId: string; readOnly: boolean }>) {
  const router = useRouter();
  const id = useId();
  const [isTest, setIsTest] = useState(initialIsTest);
  const [state, setState] = useState<LeadTestActionState>({ status: "idle", requestId, message: null, isTest: null });
  const [pending, start] = useTransition();

  function change(next: boolean) {
    if (pending || readOnly) return;
    start(async () => {
      const form = new FormData();
      form.set("lead_id", leadId);
      form.set("is_test", next ? "true" : "false");
      form.set("request_id", state.requestId);
      const result = await leadTestAction(state, form);
      setState(result);
      if (result.isTest !== null) {
        setIsTest(result.isTest);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="v3-lead-test">
      <div className="flex min-h-11 items-center gap-3">
        <Switch
          id={id}
          checked={isTest}
          onCheckedChange={change}
          disabled={readOnly}
          aria-disabled={pending || undefined}
          aria-describedby={`${id}-hint`}
          data-testid="v3-lead-test-switch"
        />
        <label htmlFor={id} className="t-body-compact text-fg">{leadTestWords.label}</label>
      </div>
      <p id={`${id}-hint`} className="t-meta text-fg-2">{readOnly ? leadTestWords.readOnly : leadTestWords.hint}</p>
      <p role="status" aria-live="polite" className="t-meta text-fg-2" data-testid="v3-lead-test-status">
        {pending ? leadTestWords.pending : state.message}
      </p>
    </div>
  );
}
