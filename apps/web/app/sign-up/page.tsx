import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { AuthForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return <AuthShell eyebrow="MAKE YOURSELF AT HOME" title="Join the playground." description="Create your player profile and find your corner of Rasmalai.">
    <AuthForm mode="signup" />
    <p className="auth-switch">Already play here? <Link href="/login">Log in</Link></p>
  </AuthShell>;
}
