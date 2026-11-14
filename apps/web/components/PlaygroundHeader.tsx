import Link from "next/link";
import { Bell, Gamepad2, UsersRound } from "lucide-react";
import { MessageCircle } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { Brand } from "@/components/Brand";

type PlaygroundSection = "playground" | "friends" | "messages" | "notifications";

export function PlaygroundHeader({ nickname, avatarUrl, unreadMessages = 0, unreadNotifications = 0, active = "playground" }: {
  nickname: string;
  avatarUrl: string | null;
  unreadMessages?: number;
  unreadNotifications?: number;
  active?: PlaygroundSection;
}) {
  return (
    <header className="playground-header">
      <Brand />
      <nav className="playground-nav" aria-label="Playground">
        <Link className={active === "playground" ? "nav-active" : ""} href="/playground"><Gamepad2 size={17} /> Playground</Link>
        <Link className={active === "friends" ? "nav-active" : ""} href="/friends"><UsersRound size={17} /> Friends</Link>
        <Link className={active === "messages" ? "nav-active" : ""} href="/messages"><MessageCircle size={16} /> Messages{unreadMessages > 0 && <span className="nav-count" aria-label={`${unreadMessages} unread messages`}>{unreadMessages}</span>}</Link>
        <Link className={active === "notifications" ? "nav-active" : ""} href="/notifications"><Bell size={16} /> Notifications{unreadNotifications > 0 && <span className="nav-count" aria-label={`${unreadNotifications} unread notifications`}>{unreadNotifications}</span>}</Link>
      </nav>
      <div className="account-menu">
        <Link className="account-link" href="/profile/setup?edit=1" aria-label="Edit your profile">
          <span className="avatar avatar--small">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : nickname.slice(0, 1).toUpperCase()}
          </span>
          <span className="account-name">{nickname}</span>
        </Link>
        <form action={signOut}><button className="text-button" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
