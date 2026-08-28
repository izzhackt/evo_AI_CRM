import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const v2RuntimeState = pgTable("v2_runtime_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull(),
});
