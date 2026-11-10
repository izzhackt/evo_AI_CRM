import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { parsePaymentCenter, type PaymentCenter } from "./payment-center.ts";

/** «Оплата» студента (миграция 358): реквизиты, платежи с историей, чеки без платежа. Сбой или чужая форма ответа - `null`. */
export async function readPaymentCenter(): Promise<PaymentCenter | null> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("student_portal_payment_center_v1");
    if (error) return null;
    return parsePaymentCenter(data);
  } catch {
    return null;
  }
}
