# Google-only authentication modes

## Application behavior

RASMALAI offers two server-enforced Google modes:

| `AUTH_BETA_MODE` | Who can authenticate | Email/password |
| --- | --- | --- |
| `invite-only-google` | A verified Google identity whose email is in the private `BETA_ALLOWED_EMAILS` list | Disabled |
| `public-google` | Any Supabase-verified Google identity with a verified email. `BETA_ALLOWED_EMAILS` is ignored. | Disabled |

`GOOGLE_OAUTH_ENABLED=true` is required in either mode. Unknown modes fail closed. The web auth context and the realtime Socket.IO verifier share this policy; authenticated profile, social, game-room, chat, and voice access continues to require the same verified Supabase session and existing resource authorization. Public authentication does not make private rooms, messages, profiles, or player actions public. Spectator mode remains disabled. Email/password Server Actions remain guarded even if called directly.

Google first-time users complete the existing `/profile/setup` flow. Existing profiles and game/social records are keyed by Supabase user ID and are not rewritten by changing modes; there is no migration. Existing Google accounts keep their current IDs. Supabase may automatically link a Google identity to an existing Supabase user with the same verified email. Review existing Auth users and test the expected account-linking behavior before opening access; the application does not run its own merge or change database records. See [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

The Render Blueprint is configured with `public-google`, Google enabled, and an empty `BETA_ALLOWED_EMAILS`. This is a checked-in desired configuration only: no Render service setting has been changed, no deploy has run, and no Supabase setting has been changed by this task. It still requires a deliberate Blueprint sync/deploy after review.

## Google Cloud steps for public sign-in

Use the existing Google Cloud project and Web OAuth client. Do not create a new credential or turn on billing for this change.

1. Open **Google Cloud Console → Google Auth Platform → Audience**. Set **User type/Audience** to **External**. `Internal` only permits users in the owning Workspace organization.
2. Under **Data Access**, retain only the sign-in scopes `openid`, `email`, and `profile` (the equivalent identity scopes are `userinfo.email` and `userinfo.profile`). The application requests exactly `openid email profile`; do not add Drive, Gmail, or other API access.
3. Under **Clients**, open the existing Web client and ensure its authorized redirect URI is exactly `https://uglnkdxmbqltfherquqo.supabase.co/auth/v1/callback`. This is Google's return URI to Supabase. It is different from the application's `/auth/callback`.
4. In **Branding**, use the real RASMALAI name and a support contact you control. Do not claim a domain you do not own. Google requires a public homepage and privacy policy for an External production app; production branding verification requires these pages on a domain verified as yours. Google says third-party hosted subdomains that you cannot verify ownership of are not suitable. The current shared `rasmalai-free-beta.onrender.com` host is not a domain the owner controls, and this repo has no published privacy-policy route, so a fully brand-verified public release is blocked until the owner has an owned/verified domain and a policy page.
5. In **Audience**, select **Publish app / In production** only after reviewing Google’s prompts and requirements. Publishing means any Google Account can authorize the OAuth client; it does not bypass RASMALAI's own verified-Google checks. Google documents that an External app in Published/Unverified status can allow any Google user for basic identity-only scopes, but the app name/logo are not displayed until brand verification. Workspace administrators can still block an unverified app. If Google Console will not allow production publishing without required app-domain details, stop; do not enter a fabricated domain or enable billing.

For this app’s basic identity-only scopes, Google currently documents an exception in Testing: the test-user list, testing warning and 7-day authorization expiration do not apply. Production status is still needed for an explicitly public audience and should be reviewed in Console. The exact UI may depend on the project's current verification state. Google references: [Audience and publishing status](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [manage app audience](https://support.google.com/cloud/answer/15549945?hl=en-MC), [brand verification requirements](https://support.google.com/cloud/answer/13464321?hl=en-KI), and [homepage requirements](https://support.google.com/cloud/answer/13807376?hl=en-AU).

Basic `openid email profile` sign-in scopes are not the sensitive/restricted Google API scopes that require sensitive-scope review. Brand/app identity requirements still apply to a production-branded app. Google may show a generic/unverified app identity until branding is accepted.

## Supabase settings to review manually

Do not change the Mumbai production project until the owner intentionally enables the public beta.

1. Confirm the project is `rasmalai-production-mumbai`, reference `uglnkdxmbqltfherquqo`.
2. In **Authentication → Sign In / Providers → Google**, confirm the provider uses the existing Google Web client. Supabase's Google callback configured in Google Cloud is the URI above.
3. In **Authentication → URL Configuration**, set the Site URL to the actual Render HTTPS origin and allow at least `https://rasmalai-free-beta.onrender.com/auth/callback`. Also allow the actual callback URLs the application uses, including `/auth/callback?next=/profile/setup` if required by Supabase's redirect matcher. Never use a guessed hostname. Supabase's redirect list is separate from Google's authorized redirect URI; see [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).
4. Review **Authentication → Users** and the identity-linking note above. Do not delete accounts or profiles.
5. Email/password is disabled inside RASMALAI in both Google modes. Supabase may separately expose its public Auth endpoints; for a Google-only project, review and disable the Supabase Email provider after assessing existing email-only users. That is a separate production dashboard action and is not changed by this code task.

## Runtime configuration

The one-service Render Blueprint now declares these values (values are not credentials):

```dotenv
AUTH_BETA_MODE=public-google
GOOGLE_OAUTH_ENABLED=true
BETA_ALLOWED_EMAILS=
SPECTATOR_MODE_ENABLED=false
```

For a private allowlisted beta, change the mode to `invite-only-google`, set a private comma-separated allowlist in Render, and keep Google enabled. Never put email addresses or provider secrets in a `NEXT_PUBLIC_` variable. Supabase, not the app browser, holds the Google client secret.

## Abuse protection and privacy

Supabase Auth applies shared IP-based rate limits to sign-in/token endpoints. The application also retains its PostgreSQL-shared limits for authenticated social and realtime actions. No new paid service or database migration is required for public mode. Google sign-in is not an anonymity or anti-abuse guarantee: use Supabase's existing Auth rate-limit controls, monitor usage, and keep existing server authorization/RLS. Supabase documents the current Auth limits at [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

RASMALAI requests only basic Google identity, uses the verified Supabase user ID for authorization, and does not need Google API access after sign-in. Its privacy policy and homepage disclosures must accurately explain how account email/profile information is used before public launch.

## Manual acceptance checks before public use

- With `public-google` and no allowlist, a new verified Google user can complete PKCE, reach profile setup, save a profile, and authenticate to Socket.IO.
- An unverified identity, non-Google Supabase account, invalid/revoked session, or missing Google provider remains rejected.
- Direct email/password Server Actions remain unavailable.
- In `invite-only-google`, an allowlisted verified Google identity works and an unlisted identity fails with the same generic public error.
- Existing users, profile IDs, friends, messages and game history remain attached to the same Supabase user IDs.
- Private rooms, messages and game actions continue to enforce existing membership authorization; spectator mode remains disabled.

These are required manual checks; this code change has not authenticated against or modified production Supabase/Render.
