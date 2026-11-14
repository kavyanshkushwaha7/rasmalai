import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { BetaAuthNotice, ForgotPasswordForm } from "@/components/AuthForms";
import { isGoogleOAuthAvailable, isPasswordAuthAvailable, readAuthBetaConfig } from "@rasmalai/database/auth-beta-policy";

export const metadata: Metadata = { title: "Reset your password" };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const beta = readAuthBetaConfig();
  const passwordAuth = isPasswordAuthAvailable(beta);
  return <AuthShell eyebrow="IT HAPPENS TO THE BEST OF US" title="Let’s get you back in." description={passwordAuth ? "Share the email on your account and we’ll send a reset link." : "Use the Google account invited to the RASMALAI beta."}>
    {passwordAuth ? <ForgotPasswordForm /> : <BetaAuthNotice googleEnabled={isGoogleOAuthAvailable(beta)} />}
    <p className="auth-switch"><Link href="/login">Back to log in</Link></p>
  </AuthShell>;
}
