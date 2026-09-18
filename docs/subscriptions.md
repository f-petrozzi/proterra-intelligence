# Digest subscriptions

The footer has two clear actions: **Subscribe to the digest** and **Invite someone**. Each opens one form at `/subscriptions` on the publication site; the address is entered only once. An invitation can include an optional plain-text name (60 characters maximum). Requests require server-verified Turnstile; no account or password is needed.

## Private records and consent

The subscription pages are served by the Review Worker but published under the site's own domain: `functions/subscriptions/` forwards `/subscriptions` and `/subscriptions/*` through the `SUBSCRIPTIONS` service binding, a private connection that never leaves Cloudflare. No other path is forwarded, so review and admin routes stay unreachable from the site. Links in email use the same domain as the publication. The Worker host and branch-preview hosts redirect subscription GETs to the canonical site, where Origin validation allows form submissions.

D1 is the authoritative list. `/subscribers` on the Review Worker displays addresses, status, source, and update time only to an authenticated active publisher in `review_users`. This list is not committed to the public repository. Internal APIs require the existing service key and remain behind the Worker Service Auth Access policy.

- An invitation or self-subscription creates a pending request with a random, single-use token. Invitations expire after 30 days, because the recipient did not ask for them and may be away. Self-subscription links expire after seven days.
- GET requests never change membership. A nonce-scoped script completes the selected action with a same-origin POST when the page is visible. Email invitation buttons use `#accept` and `#decline`; self-subscription and unsubscribe links have one default action. Old invitations without a fragment still offer both choices. JavaScript-disabled browsers retain the manual button fallback.
- This prevents ordinary GET-only link previews from changing membership. A scanner that executes JavaScript in a visible browser can still act on a bearer link; automatic completion cannot reliably distinguish that scanner from a person. Keep tokens out of logs and use the mail client's native unsubscribe mechanism where available.
- Declining or unsubscribing suppresses future third-party invitations. An address owner can request a new self-subscription.
- Every production digest is sent individually with an opaque, recipient-specific unsubscribe link. Clicking it completes the request and displays the result. Mail clients can POST the RFC 8058 key/value using either URL-encoded or multipart form data, without Origin or cookies. Old unsubscribe links become invalid after resubscription.
- The public unsubscribe form sends a seven-day confirmation link to the address owner. Knowing an address alone cannot remove it. That email link completes the unsubscribe without a second confirmation question. Responses do not reveal whether an address is subscribed.
- Gmail and Googlemail `+tag` variants share one internal subscription identity. The originally subscribed address remains the delivery address, so inbox filters continue to work, while an unsubscribe request made with the untagged address still reaches that subscription.
- Result pages stay visible, with a **Read the latest brief** button rather than a timed redirect.
- Rate limits: five form attempts per IP per hour, one request of each kind per address per UTC day, and 100 verified requests globally per UTC day. Stored rate-limit identifiers are keyed hashes; raw IPs are not retained.

Active addresses are synchronized to GitHub's `EMAIL_RECIPIENTS` secret. The sender reads D1 directly and checks membership again before each delivery, so it does not send from a stale GitHub snapshot or fall back to legacy recipients if the API fails. A message already handed to SMTP cannot be recalled.

## Activation

The code can be deployed before activation. Public request forms fail closed until the existing list has been imported and Turnstile is configured. No digest is sent by the subscription workflow.

1. Apply migrations `0004_subscriptions.sql` and `0005_subscription_inviter.sql` and deploy the Worker through the existing main-only deployment workflow.
2. Create a Cloudflare Turnstile widget whose hostnames include `proterra-intelligence.pages.dev`, where the forms are served, and the Worker's own hostname while pre-move links still work. Add its site key to `SUBSCRIPTIONS_TURNSTILE_SITE_KEY` and its secret to `SUBSCRIPTIONS_TURNSTILE_SECRET` as Worker secrets (both names are read from the Worker environment). Keep the keys out of Git. Server validation accepts either hostname and requires the `subscription` action. [Cloudflare validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
3. In the Pages project, add a service binding named `SUBSCRIPTIONS` to the `proterra-intelligence-review` Worker for both production and preview, then redeploy. The site serves the public pages through it, so the Worker needs no public Access bypass. A bypass policy for `/subscriptions` and `/subscriptions/*` is only needed while links sent before the move must keep working; delete it once they have expired. [Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)
4. Add repository Actions secret `RECIPIENT_SYNC_TOKEN`: a fine-grained GitHub token restricted to this repository with **Secrets: read and write**. The default workflow token does not have that permission. Existing Gmail and review-service secrets are reused. [GitHub repository secret API](https://docs.github.com/en/rest/actions/secrets#create-or-update-a-repository-secret)
5. Run **Digest subscriptions → import** on `main`. This imports the effective `EMAIL_RECIPIENTS` value from the `email-production` environment into D1, normalizes/deduplicates it, and marks records as `legacy`. It does not send email, print addresses, or upload them as an artifact. Empty input is rejected; a second import is rejected rather than overwriting consent records.
6. Open `https://proterra-intelligence-review.petrozzi.workers.dev/subscribers` with the publisher login and confirm the imported recipients. Imported records preserve the prior operator-approved list; they do not claim new double opt-in consent.
7. Run **Digest subscriptions → sync**, then verify requests and confirmations with an operator-controlled address before enabling the public rollout. A deliberate **process** run sends queued invitation/confirmation messages. Test accept, decline, direct subscription, and unsubscribe, and inspect Gmail Sent for delivery.
8. Set repository variable `SUBSCRIPTIONS_ENABLED=true` so the schedule also processes the queue every 15 minutes. Each accepted request already starts **Digest subscriptions → process** through the Worker's `GITHUB_WORKFLOW_TOKEN`, so email can arrive before the next scheduled run; the schedule retries anything a dispatch missed. GitHub schedules may be delayed, so delivery is not instant. A required reviewer on `email-production` also applies to these jobs; retain that control or deliberately choose an appropriate subscription-only environment before unattended activation. [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Subscription grants email membership only. It does not change any existing Access policy on the publication website, so newly invited readers may still need website access separately.

## Delivery and recovery

The subscription workflow has one concurrency group for import, synchronization, and delivery. It sends up to 25 queued messages per run using the existing Gmail account. Claimed messages have a 15-minute lease; acknowledged deliveries discard the raw confirmation token. Expired/consumed requests are cancelled before claiming.

SMTP and D1 cannot commit atomically. If Gmail accepts a message but acknowledgment fails, a retry can send the same confirmation again with the same Message-ID and token. This does not activate a subscriber or duplicate consent. Inspect Gmail Sent when a run reports a delivery/acknowledgment failure. Digest sends are not automatically retried; inspect Sent before rerunning a partially completed digest to avoid duplicates.

To pause invitation/confirmation processing, set `SUBSCRIPTIONS_ENABLED=false` and remove the Worker's `SUBSCRIPTIONS_TURNSTILE_SECRET` so public forms fail closed; otherwise each new request still dispatches delivery. Existing unsubscribe links still take effect in D1, and digest sends continue to honor D1. Never replace the database list with the GitHub snapshot after initial import: that could reactivate unsubscribed recipients. Rotating `CSRF_SECRET` invalidates previously issued digest unsubscribe links; the public email-confirmation unsubscribe form remains available.

Confirmation URLs and subscriber email addresses must not be added to public logs or artifacts. Review Cloudflare log retention/access when enabling request logging because URLs contain bearer tokens. Subscriber suppression records are intentionally retained to prevent repeated invitations.

## Combined catch-up

Preview the approved three-week catch-up:

```sh
npm run email:preview -- --report 2026-08-31,2026-09-07,2026-09-14
```

The output is `email-preview/catchup-2026-08-31-2026-09-14.html` and its plain-text counterpart. It includes all 18 articles, divided into August 24–30, August 31–September 6, and September 7–13, with issue dates and full-brief links. Historical report files are unchanged.

The same HTML is available at `/digest-preview.html` on the publication website for browser review. This static preview contains only approved report content and a generic unsubscribe link; it never includes subscriber addresses or personal unsubscribe tokens.

Use the same comma-separated value in the **Weekly email** workflow's `report` input. First choose `preview`, then `test`. After the recipient list and test email are approved, use `send` with `confirmation=2026-08-31,2026-09-07,2026-09-14`. Production requires an initialized subscriber database and approved reports. Test sends use only `EMAIL_TEST_RECIPIENT` (or the Gmail sender as fallback), never the production list.


## Browser previews and validation

`npm run build` generates `/weekly-digest-preview.html`, `/digest-preview.html` (the three-week catch-up), and `/subscribe-preview.html`, `/invite-preview.html`, `/unsubscribe-preview.html`. These use approved report content and generic subscription links only. They never contain subscriber records or bearer tokens. Preview action buttons open the public form; they do not confirm a real request.

Subscription integration tests run with `npm run review:test`. They cover token expiry, stale-version races, address ownership, suppressed invitations, lease acknowledgment, authentication, Turnstile failures, both mail-client unsubscribe encodings, and Pages route restrictions. Browser validation also needs to exercise the native form POST: static HTML assertions alone cannot detect a browser sending `Origin: null` or broken mobile columns.

## September 17 production-readiness review

- Latest site and banner URLs returned HTTP 200 without authentication. Public signup returned HTTP 200 through the site's service binding. Recent Worker deployment and subscription-processing runs succeeded.
- `SUBSCRIPTIONS_ENABLED` was not set to `true`; the latest scheduled subscription run was skipped. Immediate request-triggered delivery exists, but the scheduled retry path must be enabled for reliable recovery after a failed dispatch.
- No real subscriptions were created, no messages were sent, and no delivery schedule was enabled during this review. Consent-flow browser tests used a disposable local D1 database and mocked Turnstile verification.
- Before rollout, review the visual previews, merge the change, confirm the Worker deployment, and test delivery with an operator-controlled mailbox. Inspect the delivered message's DKIM signature for coverage of `List-Unsubscribe` and `List-Unsubscribe-Post` before claiming native mailbox one-click support. Gmail's SMTP acceptance alone does not establish inbox delivery or signature coverage. [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.txt)
- Enable the scheduled retry job after confirming that any already-pending messages are intended for delivery. Leave weekly report generation scheduling under its separate rehearsal gate.
