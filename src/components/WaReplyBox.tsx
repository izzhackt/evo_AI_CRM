"use client";

import { useRef, useTransition } from "react";

type Labels = {
  placeholder: string;
  send: string;
};

export function WaReplyBox({
  conversationId,
  sendAction,
  labels,
}: {
  conversationId: number;
  sendAction: (form: FormData) => Promise<void>;
  labels: Labels;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

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
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700"
        >
          {labels.send}
        </button>
      </form>
    </div>
  );
}
