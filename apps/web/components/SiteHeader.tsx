import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/Brand";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav className="site-nav" aria-label="Main navigation">
        <Link href="#games">Games</Link>
        <Link href="#community">Community</Link>
      </nav>
      <div className="site-header-actions">
        <Link className="nav-login" href="/login">Log in</Link>
        <Link className="button button--nav" href="/sign-up">Join the playground <ArrowUpRight size={15} /></Link>
      </div>
    </header>
  );
}
