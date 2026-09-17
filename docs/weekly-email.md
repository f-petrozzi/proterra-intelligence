# Weekly email

The pilot uses React Email for the template, Gmail SMTP for delivery, and GitHub Actions for a repeatable review and send flow. Production messages are sent individually with a personal unsubscribe link, so addresses are not exposed to one another. Production sends only accept approved reports and require the issue date (or three comma-separated dates) as a second confirmation.

See [Digest subscriptions](subscriptions.md) for the required subscriber-database import, invitation/subscribe/unsubscribe setup, private recipient list, and combined catch-up workflow. Production sends now require that setup and fail closed if the private subscriber API is unavailable.

## One-time setup

### 1. Prepare the Gmail account

1. Create `proterraintelligence@gmail.com` and set the sender display name to **Proterra Intelligence**.
2. Turn on two-step verification for the Google account.
3. In the Google Account security settings, create an app password for mail. Save the 16-character password when Google shows it; this is separate from the normal account password.
4. Keep the account recovery email and phone current. Do not share the normal Gmail password or commit the app password.

If Google does not show the App passwords option, confirm that two-step verification is active. Some security configurations, including Advanced Protection, do not permit app passwords.

### 2. Add GitHub configuration

Open the repository, then go to **Settings → Secrets and variables → Actions**.

Add these repository secrets:

| Name | Value |
| --- | --- |
| `GMAIL_USERNAME` | `proterraintelligence@gmail.com` |
| `GMAIL_APP_PASSWORD` | The Google app password, with or without spaces |
| `EMAIL_TEST_RECIPIENT` | Your own address for test messages |
| `EMAIL_RECIPIENTS` | Existing approved recipients for the initial import; subsequently maintained by subscriber synchronization |

Under **Variables**, add `SITE_URL` with the production Cloudflare Pages URL. If it is omitted, the sender falls back to `https://proterra-intelligence.pages.dev`.

Create a GitHub environment named `email-production` under **Settings → Environments**. Add you or your coworker as a required reviewer if that control is available for the repository. The issue-date confirmation remains required either way.

## Review and send an issue

1. Merge the approved report and site changes into `main`.
2. Open **Actions → Weekly email → Run workflow**.
3. Enter the report filename without `.json`, such as `2026-08-13`.
4. Run `preview`. Download the `weekly-email-YYYY-MM-DD` artifact and open the HTML file to inspect it.
5. Run the workflow again in `test` mode. Check the message in Gmail on desktop and mobile, and click the article and site links.
6. Run it once more in `send` mode. Enter the exact same issue date in the confirmation field and approve the protected environment when prompted.

Each active subscriber receives an individual message. Gmail keeps the sent copies in the account. The sender reads the private database and rechecks membership before delivery; it does not fall back to the GitHub secret.

## Local preview

Use Node.js 24.19 or newer.

```sh
npm run email:preview -- --report 2026-08-13
```

Open `email-preview/2026-08-13.html`. Without `--report`, the command selects the newest approved issue.

For a local test send, copy `.env.example` to `.env`, enter the values, load the variables into the shell, and run:

```sh
npm run email:send -- --report 2026-08-13 --mode test
```

Do not place real credentials in `.env.example`; local `.env` files and rendered previews are ignored by Git.

## Operating limits

This setup is appropriate for the two-person pilot and a small internal list. Gmail personal accounts have sending limits and are not a mailing-list platform. Before using the brief for a larger external audience, move delivery to a transactional email provider with a verified domain, subscription records, bounce handling, and unsubscribe support.

If the app password is ever exposed, revoke it in the Google Account immediately and replace the GitHub secret.
