import { PageShell, SectionTabs, type SectionTab } from "@/components/kit";
import { AdmissionsBoardNext } from "@/components/v3/admissions-pipeline-next/AdmissionsBoardNext";

/**
 * «Воронка поступления» нового вида целиком: рамка страницы («Добавить студента» и очереди проверки приходят готовыми со страницы,
 * это те же клиентские части), вкладки разделов (ссылки `?tab=` с числами), строка инструментов (поиск, страна, куратор — те же
 * части, что у прежней доски) и доска. Показывается через `AdmissionsPipelineNextLazy`.
 */
export function AdmissionsPipelineNextPage({ actions, tabs, toolbar, ...board }: Readonly<{
  actions?: React.ReactNode;
  tabs: readonly SectionTab[];
  toolbar: React.ReactNode;
} & React.ComponentProps<typeof AdmissionsBoardNext>>) {
  return (
    <PageShell title="Воронка поступления" testId="v3-admissions-pipeline" actions={actions}>
      <SectionTabs label="Разделы воронки поступления" tabs={tabs} value={board.tab} />
      {toolbar}
      <AdmissionsBoardNext {...board} />
    </PageShell>
  );
}
