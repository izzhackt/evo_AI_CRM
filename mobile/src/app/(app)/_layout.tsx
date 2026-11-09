import { router, Tabs, usePathname, type Href } from "expo-router";
import { useState } from "react";

import { MenuSheet } from "@/shell/MenuSheet";
import { SECTIONS, isAllowed, type SectionId } from "@/shell/sections";
import { TabBar } from "@/shell/TabBar";
import { TopBar } from "@/shell/TopBar";
import { useSession } from "@/session/SessionProvider";

function activeSection(pathname: string): SectionId | null {
  const name = pathname.split("/").filter(Boolean).pop() ?? "home";
  return SECTIONS.find((s) => s.id === name)?.id ?? null;
}

/**
 * Оболочка кабинета (веб #1412): плавающая панель на 4 вкладки (у approved только
 * Главная и Поступление), меню ☰ со всеми разделами уровня. Разделы вне уровня
 * закрыты Tabs.Protected, поэтому на них нельзя попасть ни по ссылке, ни из меню.
 */
export default function AppLayout() {
  const { state } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  if (state.kind !== "active") return null;
  const tier = state.session.tier;

  return (
    <>
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
      <MenuSheet
        visible={menuOpen}
        tier={tier}
        active={activeSection(pathname)}
        onClose={() => setMenuOpen(false)}
        onSelect={(id) => {
          setMenuOpen(false);
          router.navigate(`/${id}` as Href);
        }}
      />
    </>
  );
}
