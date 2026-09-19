"use client";

import { useState, useTransition } from "react";

import { setUniversityFavoriteAction } from "@/lib/portal/university-favorites-actions";

export type FavoriteToggleStrings = Readonly<{
  favoriteAdd: string;
  favoriteRemove: string;
  favoriteError: string;
}>;

/**
 * Сердечко-toggle избранного (PORT-3b): optimistic-переключение с честным
 * откатом и ошибкой при отказе сервера. Повтор нажатия безопасен — RPC
 * идемпотентен по построению (миграция 195). aria-pressed передаёт состояние
 * без опоры на цвет (WCAG: не только цветом).
 */
export function FavoriteToggle({
  institutionId,
  initialFavored,
  universityName,
  strings,
}: {
  institutionId: string;
  initialFavored: boolean;
  universityName: string;
  strings: FavoriteToggleStrings;
}) {
  const [favored, setFavored] = useState(initialFavored);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const label = `${favored ? strings.favoriteRemove : strings.favoriteAdd} — ${universityName}`;

  return (
    <span className="pt-favorite">
      <button
        type="button"
        aria-pressed={favored}
        aria-label={label}
        disabled={pending}
        className="pt-favorite-btn"
        onClick={() => {
          const previous = favored;
          const next = !previous;
          setFavored(next);
          setFailed(false);
          startTransition(async () => {
            const result = await setUniversityFavoriteAction(institutionId, next);
            if (result.ok) {
              setFavored(result.favored);
            } else {
              setFavored(previous);
              setFailed(true);
            }
          });
        }}
      >
        <svg
          className="pt-favorite-icon"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            d="M10 16.6 3.9 10.7a3.9 3.9 0 0 1 0-5.6 4 4 0 0 1 5.6 0l.5.5.5-.5a4 4 0 0 1 5.6 0 3.9 3.9 0 0 1 0 5.6z"
            fill={favored ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {failed ? (
        <span role="alert" className="pt-favorite-error">{strings.favoriteError}</span>
      ) : null}
    </span>
  );
}
