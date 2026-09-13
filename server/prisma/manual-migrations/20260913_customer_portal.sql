-- Apply this idempotent migration to an existing db:push deployment before the
-- customer-portal schema is first deployed. It only adds nullable columns and
-- constraints; no customer, visit, or media row is rewritten or deleted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_account_user_id_key') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_account_user_id_key UNIQUE (account_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_account_user_id_fkey') THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_account_user_id_fkey
      FOREIGN KEY (account_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
