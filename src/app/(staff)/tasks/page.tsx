import { redirect } from "next/navigation";

export default function LegacyTaskQueueRedirect() {
  redirect("/v3/calendar");
}
