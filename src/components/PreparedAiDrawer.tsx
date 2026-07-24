"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PreparedAiBundle } from "@/lib/prepared-ai";
import {
  preparedAiBundleFingerprint,
  resolvePreparedAiSelection,
  resolvePreparedAiStreamLength,
  type PreparedAiSelectionState,
  type PreparedAiStreamState,
} from "@/lib/prepared-ai-drawer-state";

type PreparedAiDrawerProps = {
  bundle: PreparedAiBundle;
  open: boolean;
  onClose: () => void;
  onUseReply: (text: string) => void;
};

export function PreparedAiDrawer({ bundle, open, onClose, onUseReply }: PreparedAiDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const skipFocusReturnRef = useRef(false);
  const bundleFingerprint = useMemo(
    () => preparedAiBundleFingerprint(bundle),
    [bundle],
  );
  const [selectionState, setSelectionState] = useState<PreparedAiSelectionState>({
    fingerprint: bundleFingerprint,
    selectedId: bundle.selectedScenarioId,
  });
  const selectedId = resolvePreparedAiSelection(
    bundle,
    bundleFingerprint,
    selectionState,
  );
  const selectedScenario = useMemo(
    () => bundle.scenarios.find((scenario) => scenario.id === selectedId) ?? bundle.scenarios[0],
    [bundle.scenarios, selectedId]
  );
  const selectedPrompt = useMemo(
    () => bundle.promptLibrary.find((prompt) => prompt.id === selectedScenario?.promptId),
    [bundle.promptLibrary, selectedScenario?.promptId]
  );
  const [streamState, setStreamState] = useState<PreparedAiStreamState>({
    fingerprint: bundleFingerprint,
    scenarioId: bundle.selectedScenarioId,
    length: 0,
  });
  const streamedLength = selectedScenario
    ? resolvePreparedAiStreamLength(
        bundleFingerprint,
        selectedScenario.id,
        selectedScenario.response.length,
        streamState,
      )
    : 0;
  const streamedText = selectedScenario ? selectedScenario.response.slice(0, streamedLength) : "";
  const streamComplete = Boolean(
    selectedScenario && streamedText.length >= selectedScenario.response.length,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        skipFocusReturnRef.current = false;
        dialog.showModal();
      }
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
      return;
    }

    if (dialog.open) dialog.close();
    if (!skipFocusReturnRef.current && returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus();
    }
    skipFocusReturnRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || !selectedScenario) return;
    const step = Math.max(1, Math.ceil(selectedScenario.response.length / 140));
    const timer = window.setInterval(() => {
      setStreamState((current) => {
        const currentLength = resolvePreparedAiStreamLength(
          bundleFingerprint,
          selectedScenario.id,
          selectedScenario.response.length,
          current,
        );
        const nextLength = Math.min(selectedScenario.response.length, currentLength + step);
        if (nextLength >= selectedScenario.response.length) window.clearInterval(timer);
        return {
          fingerprint: bundleFingerprint,
          scenarioId: selectedScenario.id,
          length: nextLength,
        };
      });
    }, 18);
    return () => window.clearInterval(timer);
  }, [bundleFingerprint, open, selectedScenario]);

  if (!selectedScenario) return null;

  return (
    <dialog
      id="prepared-ai-drawer"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prepared-ai-drawer-title"
      aria-describedby="prepared-ai-drawer-description"
      className="fixed inset-0 z-50 m-0 ml-auto h-dvh max-h-none w-full max-w-2xl overflow-hidden border-0 bg-transparent p-0 shadow-2xl backdrop:bg-slate-950/35"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex h-full flex-col bg-white">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="prepared-ai-drawer-title" className="text-base font-semibold text-slate-900">
                AI-черновик
              </h2>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                {bundle.label}
              </span>
            </div>
            <p id="prepared-ai-drawer-description" className="mt-1 text-xs text-slate-500">
              Демо-режим: ответ подготовлен для проверки и ещё не отправлен.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Закрыть
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[220px_1fr]">
          <nav className="border-b border-slate-200 p-3 md:border-b-0 md:border-r">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-600">Сценарии</p>
            <div className="space-y-1">
              {bundle.scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  aria-pressed={scenario.id === selectedScenario.id}
                  onClick={() =>
                    setSelectionState({
                      fingerprint: bundleFingerprint,
                      selectedId: scenario.id,
                    })
                  }
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    scenario.id === selectedScenario.id
                      ? "bg-indigo-50 font-semibold text-indigo-700"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {scenario.title}
                </button>
              ))}
            </div>
          </nav>

          <div className="min-h-0 overflow-y-auto">
            <section className="border-b border-slate-200 px-5 py-4">
              <p className="text-xs font-semibold uppercase text-slate-600">
                Инструкции для AI
              </p>
              <h3 className="mt-2 text-sm font-semibold text-slate-900">{selectedPrompt?.title ?? selectedScenario.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{selectedPrompt?.purpose ?? selectedScenario.trigger}</p>
              {selectedPrompt && (
                <ul className="mt-3 space-y-1 text-xs text-slate-500">
                  {selectedPrompt.instructions.map((instruction) => (
                    <li key={instruction}>- {instruction}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border-b border-slate-200 px-5 py-4">
              <p className="text-xs font-semibold uppercase text-slate-600">Факты из CRM</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {bundle.facts.map((fact) => (
                  <li key={fact}>- {fact}</li>
                ))}
              </ul>
            </section>

            <section className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase text-slate-600">
                  Подготовленный ответ
                </p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  Демо-режим
                </span>
              </div>
              <div
                aria-busy={!streamComplete}
                className="mt-3 min-h-36 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800"
              >
                {streamedText}
                {!streamComplete && (
                  <span aria-hidden="true" className="ml-0.5 animate-pulse">
                    |
                  </span>
                )}
              </div>
              <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {streamComplete
                  ? `Черновик готов. ${selectedScenario.response}`
                  : "Подготовка черновика…"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    skipFocusReturnRef.current = true;
                    onUseReply(selectedScenario.response);
                  }}
                  className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-800"
                >
                  Вставить в ответ
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setStreamState({
                      fingerprint: bundleFingerprint,
                      scenarioId: selectedScenario.id,
                      length: selectedScenario.response.length,
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Показать полностью
                </button>
              </div>
              <ul className="mt-4 space-y-1 text-[11px] text-slate-500">
                {selectedScenario.checks.map((check) => (
                  <li key={check}>- {check}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </dialog>
  );
}
