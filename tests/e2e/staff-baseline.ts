// Expectations for the isolated migration155 onboarding fixture, not product roles.
export const STAFF_BASELINE_HOME = {
  admin: "/main",
  sales: "/main",
  admissions: "/main",
} as const;

export const STAFF_BASELINE_CARDS = {
  admin: ["sales", "clients", "tasks", "finance", "whatsapp"],
  sales: ["sales", "clients", "finance", "whatsapp"],
  admissions: ["sales", "clients", "tasks", "finance", "whatsapp"],
} as const;
