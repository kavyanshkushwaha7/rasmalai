# Google OAuth for the RASMALAI ₹0 beta

**Status: code prepared; Google setup is owner-reported in Mumbai Supabase and is not independently verified. Render and local test OAuth remain disabled.** This guide does not change Supabase settings or deploy the app. It uses Google only for basic sign-in identity and adds no paid service or billing requirement.

## What the beta gate does

The eventual public beta is configured as `AUTH_BETA_MODE=invite-only-google`. The server permits a session only when Supabase returns a verified email, a Google identity, and an email present in the server-only `BETA_ALLOWED_EMAILS` list. An empty list or disabled Google flag denies app access. The web app and Socket.IO service read the same settings; Socket.IO rechecks the verified Supabase user before accepting a connection. Email/password signup, login, reset requests, and password changes remain in the code for future use but are unavailable in this beta mode. The existing profile setup page handles first-time Google users.

The allowlist is a controlled beta invitation list, not a self-service invite-code system. Add or remove addresses only in the private deployment environment. Do not put this list in a `NEXT_PUBLIC_` variable or client code. The login and signup routes are rendered dynamically so the server's private beta settings are read at request time rather than baked into static HTML.

## Google Cloud setup

Do this after the Render service has an assigned hostname. Do not create a billing account, enable billing, or add a card for this OAuth identity-only configuration.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project for RASMALAI. OAuth sign-in does not require enabling a paid API.
2. Open **Google Auth Platform → Branding**. Enter the app name `RASMALAI`, a support email you control, and a developer contact email. Save the branding.
3. Open **Google Auth Platform → Audience**. Choose **External**. Keep the app in **Testing** for the controlled beta and add each invited Google account under **Test users**. Google currently limits Testing apps to up to 100 listed testers; each user must also be in RASMALAI's server-side allowlist. Google's token behavior can depend on consent-screen status and requested scopes; this implementation asks only for basic identity scopes, and this must still be checked in Google's current console and policy documentation before beta use.
4. Open **Google Auth Platform → Data Access**. Keep only the basic OpenID identity scopes: `openid`, `email`, and `profile` (Google may display email/profile as `.../auth/userinfo.email` and `.../auth/userinfo.profile`). Do not add Drive, Calendar, contacts, or other scopes.
5. Open **Google Auth Platform → Clients → Create client → Web application**.
6. Add the final Render website origin under **Authorized JavaScript origins**, once known: `https://<assigned-render-hostname>`. Add `http://localhost:3000` only if you will also test the local app, then remove it from the production client if it is no longer needed.
7. Under **Authorized redirect URIs**, add the callback displayed by the Mumbai Supabase project's Google provider settings. For the current project reference, it is expected to be `https://uglnkdxmbqltfherquqo.supabase.co/auth/v1/callback`; copy and verify the exact URI from the dashboard rather than relying on this example.
8. Create the client. Copy its Client ID and Client Secret privately. Never paste them into chat, source code, `.env.example`, or Git.

Google's callback is Supabase's `/auth/v1/callback`. It is **not** the app's callback. The app callback receives the PKCE code after Supabase finishes the provider exchange.

**No-domain limitation:** Google requires production OAuth apps to use domains the app owner owns or is authorized to use, and brand verification requires verifying the relevant domain. A Render-assigned `onrender.com` hostname is not a domain you own; Google may accept it for a small Testing beta, but do not assume it will pass production brand verification. Keep the consent screen in Testing and the app restricted to named testers until the Google Console accepts the configuration. Testing mode currently caps the list at 100 accounts. An unrestricted public Google sign-in launch may require a verified domain, which would no longer meet the owner's no-domain/₹0 constraint unless a free, verifiable domain solution is found.

## Verify Mumbai Supabase setup — only after reviewing the account-linking note below

1. Confirm the project reference in **Project Settings → General** is `uglnkdxmbqltfherquqo` and the project is `rasmalai-production-mumbai` in Mumbai. Do not use `rasmalai-test` or Seoul.
2. The owner reports Google is enabled in **Authentication → Sign In / Providers → Google**. Verify it is the expected provider and callback in the Mumbai project; do not modify settings as part of this code preparation.
3. In **Authentication → URL Configuration**, once Render supplies the actual hostname:
   - Set **Site URL** to `https://<assigned-render-hostname>`.
   - Add `https://<assigned-render-hostname>/auth/callback` to allowed redirect URLs.
   - The application asks Supabase to return to `https://<assigned-render-hostname>/auth/callback?next=/profile/setup`; if the dashboard's redirect matcher requires a query-specific entry, also add that exact callback with `?next=/profile/setup`.
   - Do not set a guessed hostname. Do not change the Site URL before the real service hostname exists.
4. If the beta is intended to have Google as its only active provider, review existing Auth users, then turn off the **Email** provider in this production project as a separate dashboard change. This prevents direct calls to Supabase Auth from creating new email/password users; the app's hidden UI alone cannot prevent someone from calling Supabase's public Auth endpoint directly. This toggle was not changed here. Keep the email verification/recovery configuration intact; never disable verification to bypass delivery limits. Email/password application code remains in the repository for future re-enablement.
5. Review **Authentication → Users** before enabling Google. Do not delete users or modify database rows.

## Supabase's verified-email account linking

Supabase Auth automatically links identities that have the same verified email address. This is Supabase's verified identity-linking behavior; the app does not call a custom account-merge API or `linkIdentity()`. Supabase documents that it avoids linking against an unverified existing email. However, the automatic link does not add a separate “I consent to link these accounts” screen. Review the current production Auth user list and Supabase's [identity linking behavior](https://supabase.com/docs/guides/auth/auth-identity-linking) before enabling Google. If explicit, user-initiated linking is a hard requirement, keep `GOOGLE_OAUTH_ENABLED=false` until that policy is resolved; app code cannot stop Supabase's provider-side automatic linking after Google is enabled.

## Private Render environment values

Set these in the Render service's private **Environment** panel, not in Git:

```dotenv
AUTH_BETA_MODE=invite-only-google
GOOGLE_OAUTH_ENABLED=false
BETA_ALLOWED_EMAILS=invited.one@example.com,invited.two@example.com
NEXT_PUBLIC_SITE_URL=https://<assigned-render-hostname>
REALTIME_ALLOWED_ORIGIN=https://<assigned-render-hostname>
NEXT_PUBLIC_REALTIME_URL=
```

The email list must contain only invited addresses. Although Google setup is owner-reported in Mumbai Supabase, keep `GOOGLE_OAUTH_ENABLED=false` in Render until the actual Render origin, allowlist, identity-linking decision, and live acceptance plan are reviewed. The application fails closed if the list is empty. These auth policy variables are server-only and are shared by the web and realtime processes in the single-service Render configuration.

Do not add Google Client ID or Client Secret to the web app: Supabase owns the provider credentials. Do not add either under `NEXT_PUBLIC_`. The app only requests `openid email profile` from Google.

## Expected free-tier limitations and verification

- Google OAuth identity login has no application service fee. Keep Google Cloud billing disabled; do not enable paid Google APIs.
- While the OAuth consent screen is in Testing, the Google test-user list restricts access. Add every beta tester both there and to `BETA_ALLOWED_EMAILS`.
- The app's access list is an additional server-side check; an OAuth account omitted from it may complete the provider redirect but is signed out at the PKCE callback and cannot use protected pages or realtime sockets.
- Until the Supabase Email provider is manually disabled after user review, direct Supabase Auth API requests may still create email/password Auth users even though RASMALAI's signup/login/reset UI and Server Actions block those flows. Such users fail the app's beta authorization gate unless they have the allowlisted verified Google identity.
- After configuration, test a listed account through `/login`, finish Google consent, reach `/profile/setup`, save a profile, open `/games/online`, then test a non-listed account is rejected. Verify public website origin, callback, Socket.IO, and logout. No live OAuth flow has been tested by this preparation; the owner-reported Supabase provider configuration was not accessed.
- Google identity-provider sign-in does not itself provide a transactional email service. If future email/password signup or recovery is re-enabled, configure a verified sender/SMTP provider separately; do not disable verification to work around email delivery.

Official references: [Supabase Google sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls), [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), and [Google OAuth scopes and token behavior](https://developers.google.com/identity/protocols/oauth2).
