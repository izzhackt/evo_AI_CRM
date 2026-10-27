import { PageHeader } from "@/components/kit/PageHeader";

/**
 * Рамка страницы лида и дела в «Новом виде»: ширина и поля те же, что у `PageShell` (1240 px, 16/24), плотная шапка
 * рабочей карточки (как `PartShell dense`), над именем - возврат к списку (его нет у `PageShell`, поэтому рамка своя,
 * а шапка - из набора). Имя - единственный `h1`, действия карточки - в `actions` (главное - одно, красное).
 */
export function ProfileNextShell({
  title,
  back,
  actions,
  children,
}: Readonly<{
  title: string;
  back?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pb-8 pt-4 sm:px-6" data-testid="v3-profile-next">
      {back}
      <PageHeader title={title} actions={actions} />
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-4">{children}</div>
    </main>
  );
}
