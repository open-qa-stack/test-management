CREATE TABLE "fixture_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"attributes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fixture_items_attributes" ON "fixture_items" USING gin ("attributes");
