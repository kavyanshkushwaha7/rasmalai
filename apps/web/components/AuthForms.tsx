"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState } from "react";
import { ArrowRight, LoaderCircle, Mail, Smartphone } from "lucide-react";
import { requestPasswordReset, signInEmail, signUpEmail, startGoogleSignIn, updatePassword, type ActionState } from "@/app/actions/auth";

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

function GoogleSignInButton({ enabled }: { enabled: boolean }) {
  const [state, formAction, pending] = useActionState(startGoogleSignIn, {} as ActionState);
  return <div className="google-auth-wrap">
    <form action={formAction}>
      <button className="google-auth-button" type="submit" disabled={!enabled || pending}>
        {pending ? <LoaderCircle className="spin" size={17} /> : <span className="google-auth-mark" aria-hidden="true">G</span>}
        Continue with Google
      </button>
    </form>
    {!enabled && <p className="auth-config-note">Google sign-in is temporarily unavailable. Please try again later.</p>}
    <Feedback state={state} />
  </div>;
}

export function AuthMethods({ mode, betaMode, googleEnabled }: {
  mode: "signup" | "login";
  betaMode: "email-password" | "invite-only-google" | "public-google" | "disabled";
  googleEnabled: boolean;
}) {
  if (betaMode === "invite-only-google" || betaMode === "public-google") return <div className="auth-methods auth-methods--beta">
    <GoogleSignInButton enabled={googleEnabled} />
    <p className="auth-beta-note">{betaMode === "invite-only-google"
      ? "RASMALAI is in a limited beta. Use an invited, allowlisted Google account. New players can set up a profile after signing in."
      : "Sign in securely with a verified Google account. New players can set up a profile after signing in."}</p>
  </div>;
  if (betaMode === "disabled") return <p className="auth-config-note" role="status">Sign-in is temporarily unavailable while access is configured.</p>;

  return <div className="auth-methods">
    <GoogleSignInButton enabled={googleEnabled} />
    <div className="auth-divider"><span>OR USE EMAIL</span></div>
    <MethodSwitch />
    <EmailForm mode={mode} />
  </div>;
}

export function BetaAuthNotice({ googleEnabled, betaMode }: { googleEnabled: boolean; betaMode: "invite-only-google" | "public-google" }) {
  return <div className="auth-methods auth-methods--beta">
    <p className="auth-beta-note">{betaMode === "invite-only-google"
      ? "Password recovery is paused for this invite-only beta. Sign in with the invited Google account linked to your RASMALAI profile."
      : "Password recovery is unavailable because RASMALAI uses Google sign-in. Continue with the Google account linked to your profile."}</p>
    <GoogleSignInButton enabled={googleEnabled} />
  </div>;
}

export function PasswordResetUnavailable({ betaMode }: { betaMode: "email-password" | "invite-only-google" | "public-google" | "disabled" }) {
  const message = betaMode === "invite-only-google"
    ? "Password changes are paused during this invite-only beta. Continue using your invited Google account."
    : betaMode === "public-google"
      ? "Password changes are unavailable because RASMALAI uses Google sign-in."
      : "Password changes are currently unavailable.";
  return <p className="auth-beta-note" role="status">{message}</p>;
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
