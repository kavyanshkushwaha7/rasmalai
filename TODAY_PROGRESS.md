# RASMALAI — Phase 5 live spectator mode

**Date:** 2026-11-13

## Phase 5 implementation

- Added read-only spectator access for online Ludo, Tic Tac Toe, and Snakes & Ladders. Public spectators must be signed in; private games require an accepted, unexpired spectator invitation.
- Added invite, accept, revoke, leave, heartbeat, reconnect, active spectator count, and live public match discovery flows. Match completion and revoked access close or invalidate spectator views.
- Spectators receive game snapshots, turn/dice updates, player reactions, results, and a distinct text/emoji channel. They cannot move tokens, place marks, roll dice, read player chat, or join player voice.
- Added responsive premium-dark lobby and read-only watch route, with an explicit Watching Mode state and player names. A private waiting-room URL was checked without invitation; the UI denied spectator access and showed no board.
- Added additive migration `0008_phase5_live_spectators`, Prisma models, narrow grants, RLS policies, and guarded invitation/presence/spectator-chat RPCs. Applied in order to the configured test project using `migrate deploy`; no reset, `db push`, or data deletion.
- Added PGlite integration and realtime socket tests for public live synchronization, private invitation acceptance/revocation, third-user denial, separate spectator chat/reactions, direct-write denial, and spectator game-action denial.

## Completed

- Rechecked the shared Ludo track and yard/home joins for red, blue, green and yellow. Each color follows the same clockwise 52-square loop from its correct start, enters its own home lane after 50 shared-track moves, launches on a six, and preserves safe squares, capture, extra-turn, exact-finish and win behavior.
- Added regression coverage for choosing each of four Ludo tokens for each color when all pieces are out. Only the chosen piece changes. Browser play also rolled a six and launched the selected token onto yellow’s correct start square.
- Moved the pure Ludo, Tic Tac Toe and Snakes & Ladders engines into `packages/game-engine`; the offline app imports them through compatibility exports, and online validation uses the same engines.
- Implemented Phase 4 online Tic Tac Toe (two players), Ludo (four), and Snakes & Ladders (two to four); public rooms and invite-only rooms; verified session/roster checks; server-side turn validation and dice; versioned/idempotent state persistence; room resume/presence; private player chat/reactions; match results, profile statistics and history; and opt-in WebRTC mesh voice controls.
- Added migrations `0006_phase4_online_games` and `0007_phase4_restrict_room_summary`. They are applied in order to the configured Supabase test project without reset, `db push`, or data deletion. Migration `0007` revokes direct runtime access to the private room-summary helper while guarded room RPCs continue to use it internally.
- Added a responsive dark online lobby, room/game UI, chat panel, emoji controls, invite form, history page and explicit voice controls. Voice join is player-authorized before requesting microphone permission, begins muted, and stops tracks on leave. Voice is not recorded; spectators have no player-chat/voice access.

## Checks

- `npm test` — passed, 49/49: realtime 11/11, web 25/25, database 13/13. PGlite applied migrations `0001`–`0008` and tested spectator access, invitations, revocation, and chat isolation.
- `npm run db:generate` — passed; Prisma Client generated from the updated schema.
- `npm run db:validate` — passed.
- `npm run typecheck` — passed for realtime, web, and database.
- `npm run build --workspace @rasmalai/web -- --webpack` — passed; `/games/online/[roomId]/watch` and all existing routes compiled.
- Live `prisma migrate status` — passed; all eight migrations are recorded and the database schema is up to date.
- Live read-only schema/grant check with verified TLS/CA — spectator tables have RLS, direct spectator writes are denied to `prisma` and `authenticated`, the realtime role can execute guarded watch functions, and the private room-summary helper remains denied to the runtime role.
- Local PGlite and realtime suites — passed; public snapshot updates, snapshot/presence broadcasts to the spectator channel, private invitation and revocation, unrelated-user denial, separate spectator messages/reactions, and denial of spectator game actions/player chat/voice were exercised.
- Browser asset scan — passed; no database URL or server-only Supabase secret-key markers were found in `.next/static`.
- Browser, local app: the Phase 3 games were previously inspected at 390px and desktop widths. The Phase 5 lobby connected using the existing signed-in session and rendered at 390px and 1440px. The private-room watch gate denied access without an accepted spectator invitation at 390px and desktop width, showing no board.
- Live authenticated read: match history rendered against Supabase and returned zero completed matches for the current account.

## Still needs authorized manual testing

- No second authorized signed-in account/session was available, so no live multi-user room, cross-account message, invitation acceptance, turn synchronization, reconnection, result or chat isolation was exercised against Supabase. No account was created, no game room or test data was written.
- Browser microphone permission was not requested. Real peer-to-peer audio, mute/unmute/leave across two devices, and NAT/firewall behavior remain untested. Free STUN only is configured; restrictive networks may require TURN. No paid relay or hosting service was added.
- Phase 2’s live account-to-account friend and private-message acceptance checks remain as previously documented.

## Local services

- Web app: `http://localhost:3000`
- Realtime service health: `http://localhost:4100/health`
- Phone login remains Coming soon; email/password remains the only active auth method.

Phase 5's real board stream, accepted invitation, spectator chat, revocation during an active socket, and cross-account isolation still need live acceptance with at least two authorized sessions and an active match. The browser showed zero public live matches, and no room, account, invitation, or message was created. WebRTC device/network behavior remains untested. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for security boundaries and [docs/project-plan.md](docs/project-plan.md) for remaining release checks.

## Phase 6 — Release hardening (2026-11-13)

- Added a PWA manifest, original Rasmalai icons, and a versioned service worker that caches only `/games`, the three local game routes, and same-origin Next static assets. Authenticated, social, online-match, spectator, and API routes remain outside the cache. Navigation uses network-first with a cached local-game fallback.
- Fixed service-worker cache refresh scheduling so `waitUntil()` is registered during fetch-event dispatch, and extended the harness to check offline static assets and query-string navigations.
- Restyled the offline game lobby to the premium dark palette and added a visible keyboard-focus outline to game cards. At 390px the branding and cards stay within the viewport width.
- Read-only checks confirmed required environment variables are present; runtime/migration connection identities and pooler ports match; passwords are URL encoded; and both TLS URLs use `verify-full` with the existing CA file. Values were not printed. `.gitignore` excludes `.env*` and `/certs/`; static browser assets contain no server-secret or database-URL markers.
- `npm run db:generate` — passed.
- `npm run db:validate` — passed.
- `npm test` — passed, 51/51 (realtime 11, web 27, database/PGlite 13).
- `npm run typecheck` — passed.
- `npm run build --workspace @rasmalai/web -- --webpack` — passed; all app routes and `/manifest.webmanifest` compiled.
- `npx prisma migrate status` — read-only status passed; eight migrations are recorded and the schema is up to date. No migration was run and no database data was written.
- Local browser UI checks covered the game lobby and local game flows at mobile/desktop widths; local realtime health, manifest, and worker endpoints returned 200. The real browser was not forced offline.
- Unauthenticated local requests returned 200 for sign-up/login/reset forms and redirected protected profile, Playground, social, message, notification, and online-lobby routes to login.
- Launch blockers: two-account live Auth/social/game/spectator tests, public live game creation, real WebRTC with explicit microphone permission and a second device/network, actual browser offline reload, full accessibility/performance review, and production hosting checks remain undone. Per-socket rate limits are process-local and social actions have no shared limiter; add distributed/atomic abuse controls before public release.
- No account was created, no existing data was deleted, no browser credential was entered, and no service setting, migration, deployment, or microphone permission was changed. See [LAUNCH_READINESS.md](LAUNCH_READINESS.md) for the complete Passed/Failed/Blocked checklist and manual steps.
