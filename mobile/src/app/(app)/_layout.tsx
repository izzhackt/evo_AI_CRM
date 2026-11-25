import { router, Tabs, usePathname, type Href } from "expo-router";
import { useMemo, useState, type ComponentProps } from "react";

import { PortalPoll } from "@/api/PortalPoll";
import { PortalApiProvider, type PortalApi } from "@/api/PortalApi";
import { getConfig } from "@/config";
import { useCscaAccess } from "@/features/learning/csca/useCscaAccess";
import { EviMemoryProvider } from "@/features/learning/evi/EviMemory";
import { UniversityIndexWarmup } from "@/features/universities/IndexWarmup";
import { getSupabase, platformTransport } from "@/lib/supabase";
import { ChatFab } from "@/shell/ChatFab";
import { MenuSheet } from "@/shell/MenuSheet";
import { PollFailureNotice } from "@/shell/PollFailureNotice";
import { SECTIONS, isAllowed, type SectionId } from "@/shell/sections";
import { TabBar } from "@/shell/TabBar";
import { TopBar } from "@/shell/TopBar";
import { useSession } from "@/session/SessionProvider";

function activeSection(pathname: string): SectionId | null {
  // Первый сегмент: у вложенных разделов («Университеты») путь длиннее одного имени.
  const name = pathname.split("/").filter(Boolean)[0] ?? "home";
  return SECTIONS.find((s) => s.id === name)?.id ?? null;
}

/** Меню ☰ внутри провайдера: CSCA в нём только у студента с выбором «Китай». */
function AppMenu(props: Omit<ComponentProps<typeof MenuSheet>, "cscaAvailable">) {
  return <MenuSheet {...props} cscaAvailable={useCscaAccess().available} />;
}

/**
 * Оболочка кабинета (веб #1412, #1355): плавающая панель на 3 вкладки (Главная, Документы, Входящие;
 * у approved вкладка одна, панель не рисуется), меню ☰ со всеми разделами уровня и «Выйти». Разделы вне уровня
 * закрыты Tabs.Protected, поэтому на них нельзя попасть ни по ссылке, ни из меню. Всё, что кабинет держит в памяти (кэш
 * чтений, разговор с Эви), живёт, пока открыта эта оболочка: выход размонтирует её (`session` пуст), и чужого не остаётся.
 */
export default function AppLayout() {
  const { state, signOut } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const session = state.kind === "active" ? state.session : null;
  // Транспорт и кэш чтений живут, пока открыт кабинет; после выхода пересоздаются.
  const api = useMemo<PortalApi | null>(
    () =>
      session
        ? {
            transport: platformTransport(getSupabase()),
            studentCaseId: session.portalCase.id,
            displayName: session.authority.displayName,
            tier: session.tier,
            canSelectPrograms: session.portalCase.caseState === "active" && session.portalCase.portalActivatedAt !== null,
            userKey: session.authority.authUserId,
            membershipId: session.authority.membershipId,
            organizationId: session.authority.organizationId,
            portalBaseUrl: getConfig().portalBaseUrl,
            getAccessToken: async () => (await getSupabase().auth.getSession()).data.session?.access_token ?? null,
            refreshAccessToken: async () => {
              const { data, error } = await getSupabase().auth.refreshSession();
              return error ? null : (data.session?.access_token ?? null);
            },
          }
        : null,
    [session],
  );
  if (!session || !api) return null;
  const tier = session.tier;

  return (
    <PortalApiProvider api={api}>
      {/* Разговор с Эви держится, пока открыт кабинет (веб #1530): память снаружи экранов, переход и «Назад» её не сбрасывают. */}
      <EviMemoryProvider>
      <PortalPoll>
      <UniversityIndexWarmup />
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{ header: () => <TopBar onMenu={() => setMenuOpen(true)} /> }}
      >
        {SECTIONS.map((section) => (
          <Tabs.Protected key={section.id} guard={isAllowed(section.id, tier)}>
            <Tabs.Screen name={section.id} options={{ title: section.id }} />
          </Tabs.Protected>
        ))}
        {/* Экраны кабинета вне меню ☰ и вне панели: без объявления вкладка не показывается, а переход на неё уходит на «Главную». */}
        <Tabs.Screen name="application" options={{ title: "application" }} />
        <Tabs.Screen name="preparations" options={{ title: "preparations" }} />
      </Tabs>
      {/* «Не удалось обновить уведомления» + «Повторить» под верхней полосой, пока последний опрос не удался (веб). */}
      <PollFailureNotice />
      {/* Одна кнопка к команде EVO с любого экрана кабинета; не рисуется на «Входящих» и в беседе. */}
      <ChatFab />
      </PortalPoll>
      </EviMemoryProvider>
      <AppMenu
        visible={menuOpen}
        tier={tier}
        active={activeSection(pathname)}
        onClose={() => setMenuOpen(false)}
        onSignOut={() => {
          setMenuOpen(false);
          void signOut();
        }}
        onSelect={(id) => {
          setMenuOpen(false);
          router.navigate(`/${id}` as Href);
        }}
      />
    </PortalApiProvider>
  );
}
