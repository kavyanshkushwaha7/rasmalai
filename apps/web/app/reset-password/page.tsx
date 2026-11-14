import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { NewPasswordForm, PasswordResetUnavailable } from "@/components/AuthForms";
import { isPasswordAuthAvailable, readAuthBetaConfig } from "@rasmalai/database/auth-beta-policy";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  const beta = readAuthBetaConfig();
  const passwordAuth = isPasswordAuthAvailable(beta);
  return <AuthShell eyebrow="ALMOST BACK IN THE GAME" title={passwordAuth ? "Choose a new password." : "Use your Google account."} description={passwordAuth ? "Make it something you’ll remember next time." : "Password changes are not available for Google sign-in accounts."}>
    {beta.mode === "email-password" ? <NewPasswordForm /> : <PasswordResetUnavailable betaMode={beta.mode} />}
  </AuthShell>;
}
