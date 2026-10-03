import type { Metadata } from "next";
import "@fontsource-variable/golos-text/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";
import { getLocale } from "@/lib/i18n";
import { readRequestTheme } from "@/lib/theme-server";

export const metadata: Metadata = {
  title: {
    default: "EVO Admissions CRM",
    template: "%s | EVO Admissions CRM",
  },
  description: "EVO Admissions CRM для студентов, заявок в вузы, документов, виз, задач и финансов",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Тема ставится на сервере в самой разметке, до первой отрисовки: без
  // вспышки и без скрипта. Без cookie — светлая, тема ОС не читается
  // (решение владельца 02.10); хост сотрудников всегда светлый.
  const [locale, theme] = await Promise.all([getLocale(), readRequestTheme()]);
  return (
    <html
      lang={locale}
      data-theme={theme}
      style={{ colorScheme: theme }}
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
