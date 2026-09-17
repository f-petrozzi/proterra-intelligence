CREATE TABLE subscription_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  initialized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'declined', 'unsubscribed')),
  source TEXT NOT NULL CHECK (source IN ('legacy', 'subscribe', 'invite')),
  version INTEGER NOT NULL DEFAULT 1,
  confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscription_requests (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  kind TEXT NOT NULL CHECK (kind IN ('subscribe', 'invite', 'unsubscribe')),
  token_hash TEXT NOT NULL UNIQUE,
  subscriber_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscription_mail (
  id TEXT PRIMARY KEY REFERENCES subscription_requests(id),
  token TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'cancelled')),
  lease_id TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscription_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX subscription_mail_pending ON subscription_mail(status, lease_until);
CREATE INDEX subscription_requests_subscriber ON subscription_requests(subscriber_id);
