CREATE TYPE "ReminderState" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

CREATE TABLE "reminders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workshop_id" UUID NOT NULL,
  "report_version_id" UUID NOT NULL,
  "visit_id" UUID NOT NULL,
  "return_visit_id" UUID,
  "customer_name" TEXT NOT NULL,
  "customer_phone" TEXT NOT NULL,
  "vehicle_label" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "send_at" TIMESTAMP(3) NOT NULL,
  "state" "ReminderState" NOT NULL DEFAULT 'PENDING',
  "provider_message_id" TEXT,
  "sent_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "background_jobs" ADD COLUMN "reminder_id" UUID;

CREATE UNIQUE INDEX "reminders_report_version_id_key" ON "reminders"("report_version_id");
CREATE INDEX "reminders_workshop_id_state_send_at_idx" ON "reminders"("workshop_id", "state", "send_at");
CREATE INDEX "reminders_workshop_id_due_at_idx" ON "reminders"("workshop_id", "due_at");
CREATE INDEX "background_jobs_reminder_id_idx" ON "background_jobs"("reminder_id");

ALTER TABLE "reminders" ADD CONSTRAINT "reminders_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_report_version_id_fkey" FOREIGN KEY ("report_version_id") REFERENCES "report_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_return_visit_id_fkey" FOREIGN KEY ("return_visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
