CREATE TABLE review_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'publisher')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE review_issues (
  issue_date TEXT PRIMARY KEY,
  pull_request INTEGER NOT NULL,
  branch TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN (
    'collecting', 'source-ready', 'drafting', 'in-review', 'changes-requested',
    'revising', 'ready-to-approve', 'publishing', 'published', 'failed'
  )),
  version INTEGER NOT NULL DEFAULT 1,
  draft_sha TEXT NOT NULL,
  preview_sha TEXT,
  preview_url TEXT,
  preview_deployment_id TEXT,
  preview_alias_url TEXT,
  preview_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE review_batches (
  id TEXT PRIMARY KEY,
  issue_date TEXT NOT NULL REFERENCES review_issues(issue_date),
  submitted_by TEXT NOT NULL REFERENCES review_users(email),
  source_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'processing', 'addressed', 'resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE review_comments (
  id TEXT PRIMARY KEY,
  issue_date TEXT NOT NULL REFERENCES review_issues(issue_date),
  batch_id TEXT REFERENCES review_batches(id),
  anchor_key TEXT NOT NULL,
  story_review_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  anchor_label TEXT NOT NULL,
  selected_text TEXT,
  context_before TEXT,
  context_after TEXT,
  field_value_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  author_email TEXT NOT NULL REFERENCES review_users(email),
  status TEXT NOT NULL CHECK (status IN ('open', 'submitted', 'addressed', 'resolved')),
  source_sha TEXT NOT NULL,
  addressed_sha TEXT,
  agent_response TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX review_comments_issue_status ON review_comments(issue_date, status);
CREATE INDEX review_comments_batch ON review_comments(batch_id);

CREATE TABLE review_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES review_batches(id),
  comment_id TEXT NOT NULL REFERENCES review_comments(id),
  story_review_id TEXT NOT NULL,
  anchor_key TEXT NOT NULL,
  field_path TEXT NOT NULL,
  anchor_label TEXT NOT NULL,
  selected_text TEXT,
  context_before TEXT,
  context_after TEXT,
  instruction_body TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  field_value_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id, comment_id)
);

CREATE INDEX review_batch_items_batch ON review_batch_items(batch_id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  issue_date TEXT NOT NULL REFERENCES review_issues(issue_date),
  reviewer_email TEXT NOT NULL REFERENCES review_users(email),
  approved_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'merged', 'published', 'failed', 'invalidated')),
  approval_commit_sha TEXT,
  merge_commit_sha TEXT,
  production_deployment_id TEXT,
  production_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE review_events (
  id TEXT PRIMARY KEY,
  issue_date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
