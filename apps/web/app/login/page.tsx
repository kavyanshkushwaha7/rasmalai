import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { AuthMethods } from "@/components/AuthForms";
import { isGoogleOAuthAvailable, readAuthBetaConfig } from "@rasmalai/database/auth-beta-policy";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string; auth?: string }> }) {
  const params = await searchParams;
  const beta = readAuthBetaConfig();
  return <AuthShell eyebrow="GOOD TO SEE YOU" title="Your people are here." description="Log in and pick up right where the fun left off.">
    {params.password === "updated" && <p className="form-feedback form-feedback--success" role="status">Password updated. You can log in now.</p>}
    {params.auth === "link-expired" && <p className="form-feedback form-feedback--error" role="alert">That sign-in link expired. Try again or request a fresh password reset.</p>}
    {params.auth === "beta-access" && <p className="form-feedback form-feedback--error" role="alert">This beta is invite-only. Use an allowlisted Google account or contact the beta administrator.</p>}
    <AuthMethods mode="login" betaMode={beta.mode} googleEnabled={isGoogleOAuthAvailable(beta)} />
    {beta.mode === "email-password" && <p className="auth-switch">New around here? <Link href="/sign-up">Create an account</Link></p>}
  </AuthShell>;
}
