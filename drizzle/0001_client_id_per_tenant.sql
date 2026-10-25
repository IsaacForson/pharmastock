ALTER TABLE "payments" DROP CONSTRAINT "payments_client_id_unique";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_client_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "payments_client_uq" ON "payments" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_client_uq" ON "sales" USING btree ("tenant_id","client_id");