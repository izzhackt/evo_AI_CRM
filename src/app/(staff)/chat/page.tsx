import { redirect } from "next/navigation";

import { Icon } from "@/components/icons";
import { PageHeader, btnCls, inputCls } from "@/components/ui";
import { createChannelAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { listChannels } from "@/lib/queries";

export default async function ChatIndexPage() {
  await requireStaffRoute("/chat");
  const channels = listChannels();
  if (channels.length > 0) redirect(`/chat/${channels[0].id}`);
  const { t } = await getT();

  return (
    <div className="space-y-5">
      <PageHeader title={t("chat")} description={t("channels")} />
      <section className="mx-auto max-w-xl rounded-card border border-border bg-surface p-5 shadow-evo">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-nav bg-accent-weak text-accent">
            <Icon name="message-square" size={18} />
          </span>
          <div>
            <h2 className="text-[14px] font-bold text-fg">{t("newChannel")}</h2>
            <p className="mt-1 text-[12px] text-fg-3">{t("noMessages")}</p>
          </div>
        </div>
        <form action={createChannelAction} className="grid gap-2">
          <input name="name" required placeholder={t("channelName")} className={inputCls} />
          <input name="description" placeholder={t("description")} className={inputCls} />
          <button type="submit" className={btnCls}>{t("add")}</button>
        </form>
      </section>
    </div>
  );
}
