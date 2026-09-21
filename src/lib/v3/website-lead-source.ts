import "server-only";
import { createSupabaseServerClient } from "../supabase/server";
import type { PlatformActor } from "../platform-auth";
import { parseSalesUuid } from "../platform-sales-register-contract";
import { parseWebsiteEnquiryUniversity, type WebsiteEnquiryUniversity } from "../website-enquiry-contract";

export type WebsiteLeadSubmission = Readonly<{
  requestId: string; createdAt: string; name: string; phone: string;
  age: number | null; city: string | null; country: string;
  university: WebsiteEnquiryUniversity | null;
}>;

export async function readWebsiteLeadSubmissions(actor: PlatformActor, leadId: string): Promise<WebsiteLeadSubmission[]> {
  if (!parseSalesUuid(leadId)) throw new Error("Website inquiry is unavailable.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("read_lead_website_submissions", {
    p_organization_id: actor.organizationId, p_lead_id: leadId,
  });
  if (error || !Array.isArray(data) || data.length > 10) throw new Error("Website inquiry is unavailable.");
  return data.map(row => {
    if (!row || typeof row !== "object" || !parseSalesUuid(row.request_id)
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
      || typeof row.name !== "string" || typeof row.phone !== "string" || typeof row.country !== "string"
      || (row.city !== null && typeof row.city !== "string")
      || (row.age !== null && (!Number.isInteger(row.age) || row.age < 10 || row.age > 100))) {
      throw new Error("Website inquiry is unavailable.");
    }
    return { requestId: row.request_id, createdAt: row.created_at, name: row.name, phone: row.phone,
      age: row.age, city: row.city, country: row.country,
      university: parseWebsiteEnquiryUniversity(row.university) };
  });
}
