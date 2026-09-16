-- Gives approval creation a durable idempotency key. The public token itself
-- remains hash-only in approval_links and is never stored in this column.
ALTER TABLE "approval_versions"
ADD COLUMN "operation_id" UUID;

UPDATE "approval_versions"
SET "operation_id" = gen_random_uuid()
WHERE "operation_id" IS NULL;

ALTER TABLE "approval_versions"
ALTER COLUMN "operation_id" SET NOT NULL;

CREATE UNIQUE INDEX "approval_versions_operation_id_key"
ON "approval_versions"("operation_id");
