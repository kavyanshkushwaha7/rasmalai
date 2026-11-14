import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { AuthForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string; auth?: string }> }) {
  const params = await searchParams;
  return <AuthShell eyebrow="GOOD TO SEE YOU" title="Your people are here." description="Log in and pick up right where the fun left off.">
    {params.password === "updated" && <p className="form-feedback form-feedback--success" role="status">Password updated. You can log in now.</p>}
    {params.auth === "link-expired" && <p className="form-feedback form-feedback--error" role="alert">That sign-in link expired. Try again or request a fresh password reset.</p>}
    <AuthForm mode="login" />
    <p className="auth-switch">New around here? <Link href="/sign-up">Create an account</Link></p>
  </AuthShell>;
}
