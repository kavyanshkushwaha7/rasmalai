"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState } from "react";
import { ArrowRight, LoaderCircle, Mail, Smartphone } from "lucide-react";
import { requestPasswordReset, signInEmail, signUpEmail, updatePassword, type ActionState } from "@/app/actions/auth";

function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return <button className="button button--primary auth-submit" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : children}</button>;
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p className="form-feedback form-feedback--error" role="alert">{state.error}</p>;
  if (state.success) return <p className="form-feedback form-feedback--success" role="status">{state.success}</p>;
  return null;
}

function MethodSwitch() {
  return <div className="auth-method-switch" role="tablist" aria-label="Authentication method">
    <button type="button" role="tab" aria-selected="true" className="selected"><Mail size={15} /> Email</button>
    <button type="button" role="tab" aria-selected="false" aria-disabled="true" disabled title="Phone sign-in is coming soon"><Smartphone size={15} /> Phone <span className="auth-coming-soon">Coming soon</span></button>
  </div>;
}

function EmailForm({ mode }: { mode: "signup" | "login" }) {
  const action = mode === "signup" ? signUpEmail : signInEmail;
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  return <form action={formAction} className="auth-form">
    {mode === "signup" && <label className="field"><span>Email</span><input autoComplete="email" name="email" type="email" placeholder="you@example.com" required /></label>}
    {mode === "login" && <label className="field"><span>Email address</span><input autoComplete="email" name="email" type="email" placeholder="you@example.com" required /></label>}
    <label className="field"><span>Password</span><input autoComplete={mode === "signup" ? "new-password" : "current-password"} name="password" type="password" minLength={mode === "signup" ? 8 : undefined} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} required /></label>
    {mode === "login" && <div className="forgot-row"><Link href="/forgot-password">Forgot password?</Link></div>}
    <Feedback state={state} />
    <SubmitButton pending={pending}>{mode === "signup" ? <>Create account <ArrowRight size={16} /></> : <>Log in <ArrowRight size={16} /></>}</SubmitButton>
    {mode === "signup" && <p className="form-note">By continuing, you agree to keep it kind and play fair.</p>}
  </form>;
}

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  return <>
    <MethodSwitch />
    <EmailForm mode={mode} />
  </>;
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, {} as ActionState);
  return <form action={action} className="auth-form">
    <label className="field"><span>Email address</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
    <Feedback state={state} />
    <SubmitButton pending={pending}>Send reset link <ArrowRight size={16} /></SubmitButton>
  </form>;
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, {} as ActionState);
  return <form action={action} className="auth-form">
    <label className="field"><span>New password</span><input name="password" type="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required /></label>
    <label className="field"><span>Confirm new password</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} placeholder="Enter it once more" required /></label>
    <Feedback state={state} />
    <SubmitButton pending={pending}>Update password <ArrowRight size={16} /></SubmitButton>
  </form>;
}
