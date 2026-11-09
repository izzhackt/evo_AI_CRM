// Чтения и записи «Профиля» как запросы кабинета. Ключи под ["portal", userKey, ...]: вытягивание вниз
// на экране обновляет их вместе с остальными, выход размонтирует кэш.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { aiConsentApplies, aiConsentInProfile, type AiConsent, type AiConsentStatus } from "@web/lib/portal/ai-consent";
import type { OwnAccountDeletion } from "@web/lib/account-deletion-contract";
import type { PortalLanguage } from "@web/lib/portal/portal-profile";

import { usePortalApi } from "@/api/PortalApi";
import { accountDeletionWrite, readOwnAccountDeletion, requestAccountDeletion } from "@/features/profile/account-deletion";
import { aiConsentWrite, readAiConsent, saveAiConsent } from "@/features/profile/ai-consent";
import { readOwnLogin, readOwnProfile, saveOwnLanguage } from "@/features/profile/profile-source";
import type { FrozenWrite } from "@/lib/rpc";

const key = (userKey: string, name: string) => ["portal", userKey, name] as const;

export function useOwnProfile() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "profile"), queryFn: () => readOwnProfile(transport) });
}

export function useOwnLogin() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "login"), queryFn: () => readOwnLogin(transport) });
}

/** `scope`: "home" — вопрос только клиенту с делом на сопровождении, "profile" — любому студенту кабинета (345). */
export function useAiConsent(scope: "home" | "profile") {
  const { transport, userKey, tier } = usePortalApi();
  const enabled = scope === "home" ? aiConsentApplies(tier) : aiConsentInProfile(tier);
  return useQuery({ queryKey: key(userKey, "ai-consent"), queryFn: () => readAiConsent(transport), enabled });
}

/**
 * Идентификатор попытки живёт, пока попытка не удалась (веб: useAiConsentDecision): повтор того же выбора
 * после сбоя сети шлёт тот же запрос и тот же `p_request_id`, другой выбор или следующее решение — новый.
 */
export function createAiConsentAttempts(make: (status: AiConsentStatus) => FrozenWrite = aiConsentWrite) {
  let attempt: { status: AiConsentStatus; write: FrozenWrite } | null = null;
  return {
    writeFor(status: AiConsentStatus): FrozenWrite {
      if (attempt?.status !== status) attempt = { status, write: make(status) };
      return attempt.write;
    },
    done() {
      attempt = null;
    },
  };
}

export function useDecideAiConsent() {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const attempts = useRef(createAiConsentAttempts());
  const busy = useRef(false);
  const mutation = useMutation<AiConsent, Error, AiConsentStatus>({
    mutationFn: (status) => saveAiConsent(transport, attempts.current.writeFor(status)),
    onSuccess: (consent) => {
      attempts.current.done();
      client.setQueryData(key(userKey, "ai-consent"), consent);
    },
  });
  return {
    ...mutation,
    /** Второе нажатие, пока первое отправляется, игнорируется (веб: pendingRef). */
    decide(status: AiConsentStatus) {
      if (busy.current || mutation.isPending) return;
      busy.current = true;
      mutation.mutate(status, { onSettled: () => { busy.current = false; } });
    },
  };
}

export function useAccountDeletion() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "account-deletion"), queryFn: () => readOwnAccountDeletion(transport) });
}

/** Запись замораживается один раз на экран: повтор нажатия и сбой сети безопасны (тот же p_request_id). */
export function useRequestAccountDeletion() {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const frozen = useRef<FrozenWrite | null>(null);
  return useMutation<OwnAccountDeletion, Error, void>({
    mutationFn: () => {
      frozen.current ??= accountDeletionWrite();
      return requestAccountDeletion(transport, frozen.current);
    },
    onSuccess: (request) => client.setQueryData(key(userKey, "account-deletion"), request),
  });
}

export function useSaveLanguage() {
  const { transport } = usePortalApi();
  return useMutation<PortalLanguage, Error, PortalLanguage>({ mutationFn: (language) => saveOwnLanguage(transport, language) });
}
