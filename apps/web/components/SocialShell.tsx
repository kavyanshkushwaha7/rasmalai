import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PlaygroundHeader } from "@/components/PlaygroundHeader";

type ActiveSection = "friends" | "messages" | "notifications";

export function SocialShell({
  nickname,
  avatarUrl,
  unreadMessages,
  unreadNotifications,
  active,
  eyebrow,
  title,
  description,
  children,
}: {
  nickname: string;
  avatarUrl: string | null;
  unreadMessages: number;
  unreadNotifications: number;
  active: ActiveSection;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return <main className="app-page playground-page">
    <PlaygroundHeader nickname={nickname} avatarUrl={avatarUrl} unreadMessages={unreadMessages} unreadNotifications={unreadNotifications} active={active} />
    <div className="social-content">
      <Link className="social-back" href="/playground"><ArrowLeft size={15} /> Playground</Link>
      <div className="social-page-heading">
        <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      </div>
      {children}
    </div>
  </main>;
}

export function SocialNotice({ message, error }: { message?: string | null; error?: string | null }) {
  if (!message && !error) return null;
  return <p className={`social-notice ${error ? "social-notice--error" : "social-notice--success"}`} role={error ? "alert" : "status"}>
    {error ?? message}
  </p>;
}
