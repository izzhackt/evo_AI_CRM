import type { Metadata } from "next";
import "./globals.css";
import { getLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "EduAdmin — образовательный консалтинг",
  description: "CRM для образовательного консалтинга: клиенты, заявки в вузы, документы, визы, финансы",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
