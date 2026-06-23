import { redirect } from "next/navigation";
import { listChannels } from "@/lib/queries";

export default async function ChatIndexPage() {
  const channels = listChannels();
  if (channels.length > 0) redirect(`/chat/${channels[0].id}`);
  redirect("/dashboard");
}
