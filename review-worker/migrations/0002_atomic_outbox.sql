ALTER TABLE review_issues ADD COLUMN transition_key TEXT;
ALTER TABLE approvals ADD COLUMN transition_key TEXT;
ALTER TABLE review_comments ADD COLUMN transition_key TEXT;

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  issue_date TEXT NOT NULL REFERENCES review_issues(issue_date),
  dedupe_key TEXT NOT NULL UNIQUE,
  workflow TEXT NOT NULL,
  inputs TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_expires_at TEXT,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX notification_outbox_pending
  ON notification_outbox(status, available_at, lease_expires_at);
