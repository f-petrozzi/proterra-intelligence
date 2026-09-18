# Digest subscriptions

The site has an email box with **Subscribe** and **Share with others**, plus an **Unsubscribe** link. Requests continue to a verification form on the Worker. A confirmation email is queued only after Cloudflare Turnstile succeeds. Recipients accept or decline invitations themselves; entering another person's address never subscribes them.

## Private records and consent

D1 is the authoritative list. `/subscribers` on the Review Worker displays addresses, status, source, and update time only to an authenticated active publisher in `review_users`. This list is not committed to the public repository. Internal APIs require the existing service key and remain behind the Worker Service Auth Access policy.

- An invitation or self-subscription creates a pending request. Its random, single-use token expires after seven days.
- Opening a link does not change state. An explicit form POST accepts or declines it. An accepted request activates the subscriber and invalidates outstanding requests for that address.
- Declining or unsubscribing suppresses future third-party invitations. An address owner can request a new self-subscription.
- Every production digest is sent individually with an opaque, recipient-specific unsubscribe link. The link opens a confirmation page. Mail clients can also send the RFC 8058 one-click POST. Old unsubscribe links become invalid after resubscription.
- A public unsubscribe form emails a confirmation link; knowing another person's email is not enough to unsubscribe them.
- Rate limits: five form attempts per IP per hour, one request of each kind per address per UTC day, and 100 verified requests globally per UTC day. Stored rate-limit identifiers are keyed hashes; raw IPs are not retained.

Active addresses are synchronized to GitHub's `EMAIL_RECIPIENTS` secret. The sender reads D1 directly and checks membership again before each delivery, so it does not send from a stale GitHub snapshot or fall back to legacy recipients if the API fails. A message already handed to SMTP cannot be recalled.

## Activation

The code can be deployed before activation. Public request forms fail closed until the existing list has been imported and Turnstile is configured. No digest is sent by the subscription workflow.

1. Apply migration `0004_subscriptions.sql` and deploy the Worker through the existing main-only deployment workflow.
2. Create a Cloudflare Turnstile widget for `proterra-intelligence-review.petrozzi.workers.dev`. Add its site key to `SUBSCRIPTIONS_TURNSTILE_SITE_KEY` and its secret to `SUBSCRIPTIONS_TURNSTILE_SECRET` as Worker secrets (both names are read from the Worker environment). Keep the keys out of Git. Server validation checks the hostname and `subscription` action. [Cloudflare validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
3. Configure an Access application with a public Bypass policy **only** for the Worker's `/subscriptions` and `/subscriptions/*` paths. Keep `/subscribers`, `/review/*`, `/api/review/*`, and `/api/internal/*` protected by the existing policies. The public paths must work without a reviewer login for invitation recipients and mail-client unsubscribe POSTs. More-specific path policies take precedence. Do not bypass the whole Worker hostname. [Cloudflare path policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
4. Add repository Actions secret `RECIPIENT_SYNC_TOKEN`: a fine-grained GitHub token restricted to this repository with **Secrets: read and write**. The default workflow token does not have that permission. Existing Gmail and review-service secrets are reused. [GitHub repository secret API](https://docs.github.com/en/rest/actions/secrets#create-or-update-a-repository-secret)
5. Run **Digest subscriptions → import** on `main`. This imports the effective `EMAIL_RECIPIENTS` value from the `email-production` environment into D1, normalizes/deduplicates it, and marks records as `legacy`. It does not send email, print addresses, or upload them as an artifact. Empty input is rejected; a second import is rejected rather than overwriting consent records.
6. Open `https://proterra-intelligence-review.petrozzi.workers.dev/subscribers` with the publisher login and confirm the imported recipients. Imported records preserve the prior operator-approved list; they do not claim new double opt-in consent.
7. Run **Digest subscriptions → sync**, then verify requests and confirmations with an operator-controlled address before enabling the public rollout. A deliberate **process** run sends queued invitation/confirmation messages. Test accept, decline, direct subscription, and unsubscribe, and inspect Gmail Sent for delivery.
8. Set repository variable `SUBSCRIPTIONS_ENABLED=true` to process the queue every 15 minutes. GitHub schedules may be delayed, so delivery is not instant. A required reviewer on `email-production` also applies to these jobs; retain that control or deliberately choose an appropriate subscription-only environment before unattended activation. [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Subscription grants email membership only. It does not change any existing Access policy on the publication website, so newly invited readers may still need website access separately.

## Delivery and recovery

The subscription workflow has one concurrency group for import, synchronization, and delivery. It sends up to 25 queued messages per run using the existing Gmail account. Claimed messages have a 15-minute lease; acknowledged deliveries discard the raw confirmation token. Expired/consumed requests are cancelled before claiming.

SMTP and D1 cannot commit atomically. If Gmail accepts a message but acknowledgment fails, a retry can send the same confirmation again with the same Message-ID and token. This does not activate a subscriber or duplicate consent. Inspect Gmail Sent when a run reports a delivery/acknowledgment failure. Digest sends are not automatically retried; inspect Sent before rerunning a partially completed digest to avoid duplicates.

To pause invitation/confirmation processing, set `SUBSCRIPTIONS_ENABLED=false`. Existing unsubscribe links still take effect in D1, and digest sends continue to honor D1. Never replace the database list with the GitHub snapshot after initial import: that could reactivate unsubscribed recipients. Rotating `CSRF_SECRET` invalidates previously issued digest unsubscribe links; the public email-confirmation unsubscribe form remains available.

Confirmation URLs and subscriber email addresses must not be added to public logs or artifacts. Review Cloudflare log retention/access when enabling request logging because URLs contain bearer tokens. Subscriber suppression records are intentionally retained to prevent repeated invitations.

## Combined catch-up

Preview the approved three-week catch-up:

```sh
npm run email:preview -- --report 2026-08-31,2026-09-07,2026-09-14
```

The output is `email-preview/catchup-2026-08-31-2026-09-14.html` and its plain-text counterpart. It includes all 18 articles, divided into August 24–30, August 31–September 6, and September 7–13, with issue dates and full-brief links. Historical report files are unchanged.

The same HTML is available at `/digest-preview.html` on the publication website for browser review. This static preview contains only approved report content and a generic unsubscribe link; it never includes subscriber addresses or personal unsubscribe tokens.

Use the same comma-separated value in the **Weekly email** workflow's `report` input. First choose `preview`, then `test`. After the recipient list and test email are approved, use `send` with `confirmation=2026-08-31,2026-09-07,2026-09-14`. Production requires an initialized subscriber database and approved reports. Test sends use only `EMAIL_TEST_RECIPIENT` (or the Gmail sender as fallback), never the production list.
