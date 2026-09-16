CREATE TYPE "VerificationMethod" AS ENUM ('SMS', 'CALLCHECK');

ALTER TABLE "otp_challenges"
  ADD COLUMN "verification_method" "VerificationMethod" NOT NULL DEFAULT 'SMS',
  ADD COLUMN "provider_check_id" TEXT,
  ADD COLUMN "call_verified_at" TIMESTAMP(3);

CREATE INDEX "otp_challenges_provider_check_id_idx"
  ON "otp_challenges"("provider_check_id");
