CREATE TABLE "v2_runtime_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "v2_runtime_state" ("key", "value") VALUES ('foundation', 'ready');
