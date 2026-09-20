import "server-only";

import { LEAD_SALE_CONDITION_GROUP_KEYS, type LeadSaleConditionsGroup } from "../lead-sale-conditions-contract";
import { exactActionStringFields } from "./action-form-fields";

/** Decode the whole closed schema before reading its discriminator. */
export function decodeLeadSaleConditionsGroupForm(form: FormData): Readonly<{
  group: LeadSaleConditionsGroup;
  fields: Map<string, string>;
  commandForm: FormData;
}> | null {
  for (const group of ["sale", "wishes", "education", "conditions"] as const) {
    const fields = exactActionStringFields(form, [
      "lead_id", "expected_revision", "request_id", "field_group", ...LEAD_SALE_CONDITION_GROUP_KEYS[group],
    ]);
    if (fields?.get("field_group") !== group) continue;
    const commandForm = new FormData();
    for (const [key, value] of fields) commandForm.append(key, value);
    return { group, fields, commandForm };
  }
  return null;
}
