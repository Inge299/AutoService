CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workshop_id" UUID NOT NULL,
  "visit_id" UUID NOT NULL,
  "completed_work" TEXT NOT NULL DEFAULT '',
  "recommendations" TEXT NOT NULL DEFAULT '',
  "next_visit_at" TIMESTAMP(3),
  "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "operation_id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "workshop_id" UUID NOT NULL,
  "visit_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "customer_name" TEXT NOT NULL,
  "customer_phone" TEXT NOT NULL,
  "vehicle_label" TEXT NOT NULL,
  "license_plate" TEXT NOT NULL,
  "mileage_km" INTEGER,
  "complaint" TEXT NOT NULL,
  "completed_work" TEXT NOT NULL,
  "recommendations" TEXT NOT NULL,
  "next_visit_at" TIMESTAMP(3),
  "findings" JSONB NOT NULL,
  "media_ids" UUID[] NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_version_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "opened_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reports_visit_id_key" ON "reports"("visit_id");
CREATE INDEX "reports_workshop_id_status_updated_at_idx" ON "reports"("workshop_id", "status", "updated_at");
CREATE UNIQUE INDEX "report_versions_operation_id_key" ON "report_versions"("operation_id");
CREATE UNIQUE INDEX "report_versions_report_id_version_key" ON "report_versions"("report_id", "version");
CREATE INDEX "report_versions_workshop_id_idx" ON "report_versions"("workshop_id");
CREATE UNIQUE INDEX "report_links_report_version_id_key" ON "report_links"("report_version_id");
CREATE UNIQUE INDEX "report_links_token_hash_key" ON "report_links"("token_hash");

ALTER TABLE "reports" ADD CONSTRAINT "reports_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_links" ADD CONSTRAINT "report_links_report_version_id_fkey" FOREIGN KEY ("report_version_id") REFERENCES "report_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
