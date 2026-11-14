import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/Brand";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How RASMALAI handles sign-in information, profiles, messages, game activity, and voice chat.",
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Brand light />
        <Link className="privacy-home-link" href="/"><ArrowLeft size={15} /> Home</Link>
      </header>

      <article className="privacy-document">
        <div className="privacy-title-block">
          <span className="privacy-eyebrow"><ShieldCheck size={14} /> PRIVACY AT RASMALAI</span>
          <h1>Privacy Policy</h1>
          <p className="privacy-updated">Prepared 14 November 2026</p>
          <p className="privacy-intro">This page describes the data handling visible in the current RASMALAI application code and database design. It is a draft for the operator to review before submitting it as the final Google OAuth privacy policy.</p>
        </div>

        <aside className="privacy-review-note" aria-labelledby="privacy-review-title">
          <h2 id="privacy-review-title">Operator details still need confirmation</h2>
          <p>The project does not currently publish a legal operator name, privacy contact, retention schedule, account-deletion process, or age policy. Those details must be decided and added before this draft is treated as final. Do not use this page as a contact route for a deletion request: no privacy contact has been configured.</p>
        </aside>

        <div className="privacy-sections">
          <section className="privacy-section">
            <h2>1. Information used to sign in</h2>
            <p>RASMALAI offers Google sign-in through Supabase Auth. The application requests the basic Google scopes <code>openid</code>, <code>email</code>, and <code>profile</code>. It uses the verified account identity to authenticate the player. RASMALAI does not ask Google for Gmail, Drive, or other Google content, and does not receive the user’s Google password.</p>
            <p>Supabase Auth processes and stores the authentication account, email address, provider identity, and session information needed to sign in. RASMALAI keeps the Supabase account ID as the profile identifier. In the current application configuration, Google is the intended public sign-in method; email/password actions are gated off in public-Google mode. The Supabase provider configuration is managed separately and should be confirmed by the operator.</p>
          </section>

          <section className="privacy-section">
            <h2>2. Player profiles and public information</h2>
            <p>A player can provide a username, nickname, and profile photo. The application also stores account-linked game counts and wins. The database permits public reads of the profile ID, username, nickname, avatar fields, games played, and wins. These fields are not limited to a player’s friends. Email and phone number are not included in the public profile read grant.</p>
            <p>Profile photos are stored in the Supabase <code>profile-avatars</code> bucket, which is configured for public reads. Uploads are handled by the application server after authentication; accepted images are validated and converted to WebP. Do not upload an image you do not want publicly viewable.</p>
          </section>

          <section className="privacy-section">
            <h2>3. Friends, messages, and notifications</h2>
            <p>When players use social features, RASMALAI stores friend requests and relationships, blocks, message requests, one-to-one conversation membership, message text, message timestamps and read state. Direct conversations are available to their participants and are protected by server authorization and database policies. Notifications record events such as friend requests, messages, game invitations, and match results, and are scoped to their recipient.</p>
            <p>The application does not currently provide a self-service control to delete an account, private messages, or notifications. The database includes some deletion-related fields and cascading relationships, but that is not a complete account-deletion service or a published deletion procedure.</p>
          </section>

          <section className="privacy-section">
            <h2>4. Games and multiplayer activity</h2>
            <p>Online play stores room membership and state, validated moves, match outcomes, player statistics, rematch requests, game-room chat, and emoji reactions in Supabase PostgreSQL. Public-room information is available according to the room’s visibility; private rooms require authorization. Player chat is limited to authorized room players. Spectator Mode is disabled in the launch configuration.</p>
            <p>Offline games run in the browser. The service worker caches the supported offline game pages and their static application assets on that device. The inspected local-game code has no path that uploads offline moves as online match records. Online games require the game service and database.</p>
          </section>

          <section className="privacy-section">
            <h2>5. Optional voice chat</h2>
            <p>Voice chat is optional. The browser asks for microphone access only after a player chooses to join voice. The current application code has no audio recording or upload feature and does not use <code>MediaRecorder</code>. WebRTC attempts a direct connection between players; the realtime service handles signaling, and a public STUN service may help browsers discover a network path. Network information, including IP-related connection metadata, may be visible to the relevant peer or connection services. No TURN relay is configured, so some networks may not connect.</p>
            <p>This describes RASMALAI’s implementation; it cannot prevent participants from recording outside the application.</p>
          </section>

          <section className="privacy-section">
            <h2>6. Service providers and sharing</h2>
            <p>RASMALAI uses Google for sign-in, Supabase for authentication, database and avatar storage, and Render for the hosted application and realtime service. These providers process information needed to provide their services and may handle technical request, security, or connection logs under their own terms and retention practices. Online game information is shared with the players authorized for that room; public profile fields and profile photos are publicly readable.</p>
            <p>No advertising or analytics SDK was found in the application source reviewed for this draft. Provider-level logging and retention settings have not been independently verified here.</p>
          </section>

          <section className="privacy-section">
            <h2>7. Security, retention, and deletion</h2>
            <p>The application uses Supabase authentication, server-side authorization, and database row-level security for account-scoped data. These controls reduce unauthorized access but cannot guarantee that a system will never be compromised.</p>
            <p>Online messages, notifications, profiles, and match records are stored in the database. The project does not define an application-level retention period or automatic deletion schedule. There is no self-service account deletion feature, and no privacy request contact or manual deletion workflow is configured in the app. The operator must confirm retention periods, how users can submit deletion requests, how account and avatar files will be removed, and any records that may need to be retained before publishing a final policy.</p>
          </section>

          <section className="privacy-section">
            <h2>8. Policy details to complete before final publication</h2>
            <ul>
              <li>Legal name of the person or organization operating RASMALAI and its jurisdiction.</li>
              <li>A monitored privacy/support contact address and a workable account/data deletion request process.</li>
              <li>Retention periods for authentication records, profile data, messages, notifications, avatar files, game history, and service logs.</li>
              <li>Minimum age and any age-related restrictions.</li>
              <li>Confirmation of provider data locations, logging, and applicable cross-border processing.</li>
            </ul>
          </section>
        </div>

        <p className="privacy-footnote">This draft reflects the application source and migrations reviewed on 14 November 2026. It is not legal advice.</p>
      </article>
    </main>
  );
}
