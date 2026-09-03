export const AMOCRM_TASK_COMPLETE_TILL_MAX = 2_147_483_647;

// A datetime-local value has no timezone. This conservative UI ceiling remains
// within the signed 32-bit Unix range even in the westernmost supported zones;
// the server-side Unix check below remains the authority.
export const AMOCRM_TASK_DEADLINE_LOCAL_SAFE_MAX = "2038-01-18T15:14";
