import type { Metadata } from "next";
import "@fontsource-variable/golos-text/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";
import { getLocale } from "@/lib/i18n";

// Runs before paint: applies saved theme (cookie) or system preference.
const THEME_INIT = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=(dark|light)/);var t=m?m[1]:((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

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
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  );
}
