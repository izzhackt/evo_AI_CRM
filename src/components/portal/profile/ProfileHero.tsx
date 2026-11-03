import type { ReactNode } from "react";

import { accountInitials } from "@/components/portal/initials";

/**
 * Карточка студента наверху «Профиля» (03.11.2026): место под фото — пока
 * инициалы в круге, как у кнопки аккаунта (поля фото у студента в модели
 * нет), имя и почта из профиля 196. Справа — действие аккаунта («Выйти»),
 * под чертой — строка-ссылка (результаты тестов). Ссылку и серверное
 * действие передаёт страница: они остаются в её исходнике.
 */
export function ProfileHero({
  displayName,
  email,
  emailLabel,
  action,
  footer,
}: Readonly<{
  displayName: string;
  email: string;
  emailLabel: string;
  action: ReactNode;
  footer: ReactNode;
}>) {
  return (
    <section aria-labelledby="portal-profile-data" className="pt-profile-hero">
      <div className="pt-profile-hero-main">
        <span className="pt-profile-avatar" aria-hidden="true">{accountInitials(displayName)}</span>
        <div className="pt-profile-identity">
          <h2 id="portal-profile-data" className="pt-profile-name">{displayName}</h2>
          <p className="pt-profile-email">
            <span className="pt-sr-only">{emailLabel}: </span>
            {email}
          </p>
        </div>
        <div className="pt-profile-hero-action">{action}</div>
      </div>
      <div className="pt-profile-hero-foot">{footer}</div>
    </section>
  );
}
