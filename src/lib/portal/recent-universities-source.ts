import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { parseRecentUniversities, type RecentUniversity } from "./recent-universities";

export async function readStudentRecentUniversities(): Promise<readonly RecentUniversity[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("student_recent_universities_v1");
  const items = !error && parseRecentUniversities(data);
  if (!items) throw new Error("Recent universities unavailable");
  return items;
}
