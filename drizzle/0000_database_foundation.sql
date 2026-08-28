CREATE TABLE "evo_database_contract" (
	"id" integer PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"authority" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "evo_database_contract" ("id", "version", "authority") VALUES (1, 1, 'postgresql');
