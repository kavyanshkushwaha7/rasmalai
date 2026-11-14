import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/Brand";

export function AuthShell({ eyebrow, title, description, children, footer }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="auth-topbar"><Brand /><Link className="back-link" href="/"><ArrowLeft size={15} /> Back home</Link></div>
      <div className="auth-layout">
        <section className="auth-aside">
          <div className="eyebrow eyebrow--light"><span className="eyebrow-dot" /> GOOD GAMES, GOOD COMPANY</div>
          <h1>Find your<br /><em>people.</em></h1>
          <p>Set up your corner of the playground. Your next favorite game is better with friends around.</p>
          <div className="auth-aside-art"><span className="auth-orbit auth-orbit--one" /><span className="auth-orbit auth-orbit--two" /><span className="auth-aside-token auth-aside-token--pink">×</span><span className="auth-aside-token auth-aside-token--mint">○</span><span className="auth-star">✦</span></div>
          <span className="auth-aside-foot">A little friendly competition never hurt.</span>
        </section>
        <section className="auth-card">
          <div className="auth-card-heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </section>
      </div>
    </main>
  );
}
