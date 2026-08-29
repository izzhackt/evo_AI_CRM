import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const DATABASE_CONTRACT_ROW_ID = 1;
export const DATABASE_CONTRACT_VERSION = 4;
export const DATABASE_CONTRACT_AUTHORITY = "postgresql";

export const evoDatabaseContract = pgTable("evo_database_contract", {
  id: integer("id").primaryKey(),
  version: integer("version").notNull(),
  authority: text("authority").notNull(),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull(),
});
