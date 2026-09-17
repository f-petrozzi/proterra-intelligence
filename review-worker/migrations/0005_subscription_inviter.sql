-- Optional name an inviter gives so the invitation can say who it is from.
ALTER TABLE subscription_requests ADD COLUMN inviter_name TEXT;
