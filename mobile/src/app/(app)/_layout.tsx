import { router, Tabs, usePathname, type Href } from "expo-router";
import { useMemo, useState } from "react";

import { PortalPoll } from "@/api/PortalPoll";
import { PortalApiProvider, type PortalApi } from "@/api/PortalApi";
import { getConfig } from "@/config";
import { UniversityIndexWarmup } from "@/features/universities/IndexWarmup";
import { getSupabase, platformTransport } from "@/lib/supabase";
import { ChatFab } from "@/shell/ChatFab";
import { MenuSheet } from "@/shell/MenuSheet";
import { SECTIONS, isAllowed, type SectionId } from "@/shell/sections";
import { TabBar } from "@/shell/TabBar";
import { TopBar } from "@/shell/TopBar";
import { useSession } from "@/session/SessionProvider";

function activeSection(pathname: string): SectionId | null {
  // Первый сегмент: у вложенных разделов («Университеты») путь длиннее одного имени.
  const name = pathname.split("/").filter(Boolean)[0] ?? "home";
  return SECTIONS.find((s) => s.id === name)?.id ?? null;
}

/**
 * Оболочка кабинета (веб #1412, #1355): плавающая панель на 3 вкладки (Главная, Документы, Входящие;
 * у approved вкладка одна, панель не рисуется), меню ☰ со всеми разделами уровня и «Выйти». Разделы вне уровня
 * закрыты Tabs.Protected, поэтому на них нельзя попасть ни по ссылке, ни из меню.
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
      </Tabs>
      {/* Одна кнопка к команде EVO с любого экрана кабинета; не рисуется на «Входящих» и в беседе. */}
      <ChatFab />
      </PortalPoll>
      <MenuSheet
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
