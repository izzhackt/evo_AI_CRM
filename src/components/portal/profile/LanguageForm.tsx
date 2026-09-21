"use client";

import { useRef, useState, useTransition } from "react";

import { setPortalLanguageAction } from "@/lib/portal/portal-profile-actions";
import type { PortalLanguage } from "@/lib/portal/portal-profile";

export type LanguageFormStrings = Readonly<{
  languageHeading: string;
  languageHint: string;
  languageRu: string;
  languageKy: string;
  languageSave: string;
  languageSaved: string;
  languageError: string;
}>;

/**
 * Язык портала (PORT-5a): выбор RU/KY, сохранение через RPC миграции 196 +
 * cookie в одном server action. Состояние честное: «сохранён» только после
 * подтверждения сервера, ошибка — с откатом выбора не требуется (выбор
 * остаётся на экране, повтор безопасен).
 */
export function LanguageForm({
  initialLanguage,
  strings,
}: {
  initialLanguage: PortalLanguage;
  strings: LanguageFormStrings;
}) {
  const [selected, setSelected] = useState<PortalLanguage>(initialLanguage);
  const [saved, setSaved] = useState<PortalLanguage>(initialLanguage);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(false);

  const options: readonly { value: PortalLanguage; label: string }[] = [
    { value: "ru", label: strings.languageRu },
    { value: "ky", label: strings.languageKy },
  ];

  return (
    <form
      className="pt-profile-language"
      onSubmit={(event) => {
        event.preventDefault();
        if (pendingRef.current || pending || selected === saved) return;
        pendingRef.current = true;
        setStatus("idle");
        startTransition(async () => {
          try {
            const result = await setPortalLanguageAction(selected);
            if (result.ok) {
              setSaved(result.portalLanguage);
              setStatus("saved");
            } else {
              setStatus("failed");
            }
          } catch {
            setStatus("failed");
          } finally {
            pendingRef.current = false;
          }
        });
      }}
    >
      <p className="pt-profile-hint">{strings.languageHint}</p>
      <div className="pt-profile-language-options" role="radiogroup" aria-label={strings.languageHeading}>
        {options.map((option) => (
          <label key={option.value} className="pt-profile-language-option">
            <input
              type="radio"
              name="portal-language"
              value={option.value}
              checked={selected === option.value}
              onChange={() => {
                setSelected(option.value);
                setStatus("idle");
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className="pt-profile-language-submit">
        <button type="submit" className="pt-btn" aria-disabled={pending || selected === saved} aria-busy={pending}>
          {strings.languageSave}
        </button>
        <span role="status" className="pt-profile-status">
          {status === "saved" ? strings.languageSaved : ""}
        </span>
        {status === "failed" ? (
          <span role="alert" className="pt-favorite-error">{strings.languageError}</span>
        ) : null}
      </div>
    </form>
  );
}
