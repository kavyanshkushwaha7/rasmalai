import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Database, Sparkles } from "lucide-react";
import { isDatabaseConfigured, withAuthenticatedUser } from "@rasmalai/database";
import { PlaygroundHeader } from "@/components/PlaygroundHeader";
import { ProfileSetupForm } from "@/components/ProfileSetupForm";
import { getAuthenticatedUserContext } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your player profile" };

export default async function ProfileSetupPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const auth = await getAuthenticatedUserContext();
  const user = auth?.user ?? null;
  if (!user && isSupabaseConfigured()) redirect("/login");
  if (!user) return <main className="setup-page"><div className="setup-message"><Sparkles size={24} /><h1>Make a profile that feels like you.</h1><p>Sign up or log in first, then we’ll save your nickname and username here.</p><Link className="button button--primary" href="/sign-up">Create account</Link></div></main>;

  const databaseReady = isDatabaseConfigured();
  let profile = null;
  let profileLoadError = false;
  if (databaseReady) {
    try {
      profile = await withAuthenticatedUser(auth!.accessToken, (db) =>
        db.profile.findUnique({
          where: { id: user.id },
          select: { id: true, username: true, nickname: true, avatarUrl: true, avatarPath: true },
        }),
      );
    } catch (error) {
      console.error("Could not load Rasmalai profile setup", error);
      profileLoadError = true;
    }
  }
  if (profile && edit !== "1") redirect("/playground");

  const profileAvatarUrl = profile?.avatarPath
    ? auth!.supabase.storage.from("profile-avatars").getPublicUrl(profile.avatarPath).data.publicUrl
    : profile?.avatarUrl ?? null;
  return <main className="app-page">
    <PlaygroundHeader nickname={profile?.nickname ?? user.user_metadata?.nickname ?? "New player"} avatarUrl={profileAvatarUrl} />
    <section className="setup-content">
      <Link className="back-link back-link--green" href={profile ? "/playground" : "/"}><ArrowLeft size={15} /> {profile ? "Back to Playground" : "Back home"}</Link>
      <div className="setup-heading"><span className="eyebrow"><span className="eyebrow-dot" /> PLAYER PROFILE</span><h1>{profile ? "Make it feel like you." : "Your name on the board."}</h1><p>A few details help your friends spot you around the playground.</p></div>
      {!databaseReady || profileLoadError ? <div className="setup-config-notice"><Database size={20} /><div><b>{profileLoadError ? "Profile storage is unavailable" : "Connect profile storage to continue"}</b><p>{profileLoadError ? <>Check the database connection, Prisma role membership and migrations, then reload this page. Setup steps are in the project’s <code>README.md</code>.</> : <>Add <code>DATABASE_URL</code> with <code>sslmode=verify-full</code> and the Supabase CA path to the web server environment. Keep migration credentials in the database package environment only. Setup steps are in the project’s <code>README.md</code>.</>}</p></div></div> : <ProfileSetupForm initialUsername={profile?.username ?? ""} initialNickname={profile?.nickname ?? ""} initialAvatarUrl={profileAvatarUrl} />}
    </section>
  </main>;
}
