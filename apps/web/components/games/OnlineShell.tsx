import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Grid2X2, History } from "lucide-react";
import { Brand } from "@/components/Brand";

export function OnlineShell({ children }: { children: ReactNode }) {
  return <main className="online-page">
    <header className="online-header">
      <Brand light />
      <nav aria-label="Online game navigation">
        <Link href="/games"><Grid2X2 size={15} /> Offline games</Link>
        <Link href="/games/online/history"><History size={15} /> Match history</Link>
        <Link href="/playground"><ArrowLeft size={15} /> Playground</Link>
      </nav>
    </header>
    <div className="online-content">{children}</div>
  </main>;
}
