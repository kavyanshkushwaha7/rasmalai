# Private HTTPS voice testing (Mac + Android)

This setup is for private testing, not production. It runs the existing Next.js and Socket.IO development services on loopback, then uses Tailscale Serve to provide a TLS URL only to devices in your tailnet. Do not use Tailscale Funnel or router port forwarding.

`getUserMedia()` requires a secure browser context. HTTPS qualifies, as does `localhost` on the same device; a Mac's `http://192.168…` Wi-Fi URL does not. In that insecure context browsers may omit `navigator.mediaDevices`, which previously made RASMALAI report that the browser did not support microphones. See [MDN's getUserMedia security notes](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

## One-time device and Supabase setup

1. Install and sign in to Tailscale on the Mac and Android using accounts in the same private tailnet. Keep both devices connected while testing. Confirm the Mac appears in `tailscale status`.
2. Enable MagicDNS and HTTPS certificates for the tailnet if Tailscale asks. Use the Mac's full `*.ts.net` hostname shown by Tailscale. Tailscale Serve terminates HTTPS and is available to the tailnet; its docs distinguish it from Funnel, which exposes a service publicly. See [Serve setup](https://tailscale.com/docs/features/tailscale-serve) and [HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates).
3. In the Supabase test project's **Authentication → URL Configuration → Redirect URLs**, add these three URLs with `<MAC-TAILNET-HOST>` replaced by the Mac hostname (no angle brackets):

   ```text
   https://<MAC-TAILNET-HOST>/auth/callback
   https://<MAC-TAILNET-HOST>/auth/callback?next=/profile/setup
   https://<MAC-TAILNET-HOST>/auth/callback?next=/reset-password
   ```

   Leave the Supabase **Site URL** unchanged. This setup only adds the specific test callbacks; do not use a broad wildcard.

Tailscale's Personal plan is listed as $0 for personal use with up to six users, but eligibility depends on account/use type; confirm the current plan before relying on it. This is an optional third-party service, not an app dependency.

## Start the private test services

Use three Terminal windows. Replace the host placeholder with the same full hostname from step 2. These commands do not change `.env.local` or any database setting.

**Terminal 1 — realtime service** (from the project root):

```sh
export NEXT_PUBLIC_SITE_URL="https://<MAC-TAILNET-HOST>"
export REALTIME_ALLOWED_ORIGIN="$NEXT_PUBLIC_SITE_URL"
export REALTIME_HOST=127.0.0.1
export REALTIME_PORT=4101
npm run dev:realtime
```

**Terminal 2 — web app** (from the project root):

```sh
export NEXT_PUBLIC_SITE_URL="https://<MAC-TAILNET-HOST>"
export NEXT_PUBLIC_REALTIME_URL="https://<MAC-TAILNET-HOST>:8443"
npm run dev:secure-test --workspace @rasmalai/web
```

The secure-test command uses a separate `.next-secure-test` build directory, so it can run beside an existing web development process without sharing Next.js chunks.

**Terminal 3 — private HTTPS front door:**

```sh
tailscale serve --bg --https=443 http://127.0.0.1:3100
tailscale serve --bg --https=8443 http://127.0.0.1:4101
tailscale serve status
```

The status should show the Mac `*.ts.net` host proxying HTTPS port 443 to `127.0.0.1:3100` and HTTPS port 8443 to `127.0.0.1:4101`. The browser's Socket.IO endpoint is HTTPS on port 8443, so its WebSocket transport is WSS. The realtime app still checks the exact HTTPS web `Origin` and verifies the Supabase access token; TLS termination does not replace app authentication.

## Test on Mac and Android

1. On the Mac, open `https://<MAC-TAILNET-HOST>` in a current browser. On Android, confirm Tailscale says **Connected**, then open that exact same HTTPS URL in Chrome (not an in-app browser). Check the address bar shows a valid secure connection.
2. Sign in to two different authorized test accounts. Open the same online room on both devices. Wait until both show connected before starting voice.
3. On each device, the player must explicitly tap **Join voice** and grant microphone permission when prompted. Joining starts muted. Each player then taps **Unmute** when ready; speak in turn and confirm both can hear the other. Test **Mute**, **Unmute**, and **Leave voice** on both clients.
4. If signaling connects but voice media does not, retry both devices on the same Wi-Fi and check OS/browser microphone permission. This project uses STUN but has no TURN relay, so networks with restrictive NAT/firewalls can block peer media; do not interpret that as an HTTPS or authentication failure.

No voice session is opened automatically. Audio is not recorded. HTTPS removes the browser secure-context restriction, but real cross-device voice must still be tested on the devices; local unit tests cannot prove microphone permission or WebRTC media connectivity.

## Stop the test

Stop both npm processes with `Ctrl+C`. To remove only these two Serve listeners, run:

```sh
tailscale serve --https=443 off
tailscale serve --https=8443 off
```

This leaves the existing `localhost:3000` and `localhost:4100` setup untouched.
