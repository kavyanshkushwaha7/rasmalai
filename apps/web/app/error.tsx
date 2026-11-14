"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="setup-page">
      <section className="setup-message">
        <h1>This page couldn’t load.</h1>
        <p>Your sign-in is not cleared by a page retry. Try again; if Supabase confirms that your session expired or was revoked, Rasmalai will ask you to sign in.</p>
        <button className="button button--primary" onClick={reset} type="button">Try again</button>
      </section>
    </main>
  );
}
