import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { AuthMethods } from "@/components/AuthForms";
import { isGoogleOAuthAvailable, readAuthBetaConfig } from "@rasmalai/database/auth-beta-policy";

export const metadata: Metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  const beta = readAuthBetaConfig();
  return <AuthShell eyebrow="MAKE YOURSELF AT HOME" title="Join the playground." description={beta.mode === "invite-only-google" ? "Continue with your invited Google account to set up your player profile." : "Create your player profile and find your corner of Rasmalai."}>
    <AuthMethods mode="signup" betaMode={beta.mode} googleEnabled={isGoogleOAuthAvailable(beta)} />
    {beta.mode !== "disabled" && <p className="auth-switch">{beta.mode === "invite-only-google" ? "Already invited?" : "Already play here?"} <Link href="/login">Log in</Link></p>}
  </AuthShell>;
}
