import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * #1358: лента одна — «Что нового» во «Входящих». Старый адрес остаётся только
 * как переход (закладки, письма и уведомления прежних выпусков).
 */
export default function StudentPortalNotificationsPage(): never {
  redirect("/portal/messages?view=updates");
}
