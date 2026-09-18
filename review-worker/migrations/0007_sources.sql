CREATE TABLE source_submissions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('source','story')),
  canonical_url TEXT NOT NULL,
  author TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','applied')),
  version INTEGER NOT NULL DEFAULT 1,
  accepted_payload TEXT,
  reviewed_by TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  sync_error TEXT,
  applied_sha TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX source_submission_pending_url ON source_submissions(kind, canonical_url) WHERE status IN ('pending','accepted');
CREATE TABLE source_submission_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES source_submissions(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE source_coverage_checks (
  issue_date TEXT NOT NULL,
  area TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('checked','unavailable')),
  note TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(issue_date, area)
);
CREATE TABLE source_collection_runs (
  run_date TEXT PRIMARY KEY,
  candidates TEXT NOT NULL,
  manifest TEXT NOT NULL,
  completed_at TEXT NOT NULL
);
