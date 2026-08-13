# Contributing

All report changes use a branch and pull request. Do not commit generated research directly to `main`.

## Reports

1. Copy `templates/report.template.json` to `src/data/reports/YYYY-MM-DD.json`.
2. Use only source IDs registered in `src/data/sources.json`.
3. Keep the report in `draft` while editing and reviewing the preview.
4. Run `npm run verify` before requesting review.
5. Complete the editorial checklist in the pull request.
6. Change the status to `approved` only after human review.

## Sources

A source-registry change should explain ownership, editorial or scientific authority, update cadence, canonical domain, and any known limitation. Approval means the source is eligible for evidence; it does not make every claim from that source reliable.

Never rewrite an approved historical report silently. Correct it in a dedicated pull request and document the reason.
