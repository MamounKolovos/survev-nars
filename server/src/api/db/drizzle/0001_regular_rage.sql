CREATE TABLE "replays" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
