import { redirect } from "next/navigation";
import { listChannels } from "@/lib/queries";
import { requireStaffRoute } from "@/lib/guards";

export default async function ChatIndexPage() {
  await requireStaffRoute("/chat");
  const channels = listChannels();
  if (channels.length > 0) redirect(`/chat/${channels[0].id}`);
  redirect("/dashboard");
}
