import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getPayment } from "@/lib/queries";
import { markPaymentPaidAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, PageHeader, btnCls, btnGhostCls } from "@/components/ui";
import {
  ContextBanner,
  DetailBackLink,
  KeyValueGrid,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";

const num = (value: number) => value.toLocaleString("ru-RU");

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireStaffRoute("/finance");
  const { t } = await getT();
  const { id } = await params;
  const payment = getPayment(Number(id));
  if (!payment) notFound();

  const canMutate = user.role === "admin" || user.role === "finance";
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue =
    payment.status !== "paid" &&
    !!payment.due_date &&
    payment.due_date < today;
  const visibleStatus = isOverdue ? "overdue" : payment.status;

  const resolveAction =
    canMutate && payment.status !== "paid" ? (
      <form action={markPaymentPaidAction}>
        <input type="hidden" name="id" value={payment.id} />
        <button type="submit" className={btnCls}>{t("markPaid")}</button>
      </form>
    ) : undefined;

  return (
    <div className="space-y-5">
      <DetailBackLink href="/finance" label={t("backToQueue")} />

      <PageHeader
        eyebrow={t("paymentDetail")}
        title={payment.title}
        description={`${payment.client_name} · ${num(payment.amount)} ${payment.currency}`}
        action={<Badge value={visibleStatus} label={t(`pay.${visibleStatus}`)} />}
      />

      {isOverdue ? (
        <ContextBanner
          title={t("attentionRequired")}
          description={`${t("deadlinePassed")}: ${payment.due_date}`}
          tone="danger"
          action={resolveAction}
        />
      ) : (
        <ContextBanner
          title={payment.status === "paid" ? t("pay.paid") : t("sourceBoundary")}
          description={payment.status === "paid" ? `${t("paidAt")}: ${payment.paid_at ?? "—"}` : t("localRecordHint")}
          tone={payment.status === "paid" ? "info" : "neutral"}
          action={resolveAction}
        />
      )}

      <QueueMetrics
        items={[
          { label: t("amount"), value: num(payment.amount), meta: payment.currency, tone: "accent" },
          { label: t("dueDate"), value: payment.due_date ?? "—", tone: isOverdue ? "danger" : "info" },
          { label: t("status"), value: t(`pay.${visibleStatus}`), tone: visibleStatus === "paid" ? "ok" : visibleStatus === "overdue" ? "danger" : "warn" },
          { label: t("paidAt"), value: payment.paid_at ?? "—", tone: payment.paid_at ? "ok" : "info" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-5">
          <Card title={t("recordDetails")}>
            <KeyValueGrid
              items={[
                { label: t("payment"), value: payment.title },
                { label: t("client"), value: payment.client_name },
                { label: t("amount"), value: `${num(payment.amount)} ${payment.currency}` },
                { label: t("dueDate"), value: payment.due_date },
                { label: t("status"), value: <Badge value={visibleStatus} label={t(`pay.${visibleStatus}`)} /> },
                { label: t("paidAt"), value: payment.paid_at },
              ]}
            />
          </Card>

          <ContextBanner
            title={canMutate ? t("resolution") : t("readOnly")}
            description={canMutate ? t("paymentDetailHint") : t("financeReadOnlyHint")}
            tone={canMutate ? "info" : "warning"}
            action={resolveAction}
          />
        </div>

        <aside className="space-y-5">
          <Card title={t("owner")}>
            <KeyValueGrid
              items={[
                { label: t("manager"), value: payment.manager_name ?? t("notAssigned") },
                { label: t("country"), value: payment.target_country },
                { label: t("operationalStageNotice"), value: <Badge value={payment.stage} label={t(`stage.${payment.stage}`)} /> },
              ]}
            />
            <Link href={`/clients/${payment.client_id}`} className={`${btnGhostCls} mt-4 w-full`}>
              {t("openStudent360")}
            </Link>
          </Card>

          <ContextBanner
            title={t("sourceBoundary")}
            description={t("localRecordHint")}
            tone="neutral"
          />
        </aside>
      </div>
    </div>
  );
}
