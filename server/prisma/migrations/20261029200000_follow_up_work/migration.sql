ALTER TABLE findings ADD COLUMN follow_up_due_at TIMESTAMP(3),
 ADD COLUMN follow_up_configured BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN follow_up_state TEXT NOT NULL DEFAULT 'OPEN',
 ADD COLUMN follow_up_completed_at TIMESTAMP(3);
ALTER TABLE findings ADD CONSTRAINT findings_follow_up_state_check CHECK (follow_up_state IN ('OPEN','DONE','CANCELLED'));
DROP INDEX reminders_report_version_id_key;
ALTER TABLE reminders ADD COLUMN finding_id UUID;
ALTER TABLE reminders ADD CONSTRAINT reminders_finding_id_fkey FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX reminders_report_version_id_idx ON reminders(report_version_id);
CREATE INDEX reminders_finding_id_idx ON reminders(finding_id);
