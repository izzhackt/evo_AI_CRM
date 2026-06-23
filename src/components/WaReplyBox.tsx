"use client";

import { useRef, useState, useTransition } from "react";
import { PreparedAiDrawer } from "@/components/PreparedAiDrawer";
import type { PreparedAiBundle } from "@/lib/prepared-ai";

type Labels = {
  placeholder: string;
  send: string;
  aiDraft: string;
  aiThinking: string;
  aiNotConfigured: string;
};

export function WaReplyBox({
  conversationId,
  sendAction,
  labels,
  preparedAi,
}: {
  conversationId: number;
  sendAction: (form: FormData) => Promise<void>;
  labels: Labels;
  preparedAi?: PreparedAiBundle;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [, startTransition] = useTransition();

  function insertPreparedReply(text: string) {
    if (inputRef.current) {
      inputRef.current.value = text;
      inputRef.current.focus();
    }
    setDrawerOpen(false);
  }

  return (
    <div className="border-t border-slate-100 p-3">
      <form
        action={(form) => {
          startTransition(async () => {
            await sendAction(form);
            if (inputRef.current) inputRef.current.value = "";
          });
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="conversation_id" value={conversationId} />
        <input
          ref={inputRef}
          name="text"
          required
          autoComplete="off"
          placeholder={labels.placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        {preparedAi && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            title={labels.aiDraft}
            className="shrink-0 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-100"
          >
            AI
          </button>
        )}
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700"
        >
          {labels.send}
        </button>
      </form>
      {preparedAi && (
        <PreparedAiDrawer
          bundle={preparedAi}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onUseReply={insertPreparedReply}
        />
      )}
    </div>
  );
}
