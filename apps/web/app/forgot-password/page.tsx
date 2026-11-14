import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ForgotPasswordForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return <AuthShell eyebrow="IT HAPPENS TO THE BEST OF US" title="Let’s get you back in." description="Share the email on your account and we’ll send a reset link.">
    <ForgotPasswordForm />
    <p className="auth-switch"><Link href="/login">Back to log in</Link></p>
  </AuthShell>;
}
