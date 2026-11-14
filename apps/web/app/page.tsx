import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Sparkles, UsersRound } from "lucide-react";
import { GameArtwork, type GameKind } from "@/components/GameArtwork";
import { SiteHeader } from "@/components/SiteHeader";

const games: { name: string; kind: GameKind; detail: string; tag: string; href: string }[] = [
  { name: "Ludo", kind: "ludo", detail: "A little luck. A lot of rematches.", tag: "THE CLASSIC", href: "/games/ludo" },
  { name: "Tic Tac Toe", kind: "tic-tac-toe", detail: "Quick rounds, big main-character energy.", tag: "QUICK PLAY", href: "/games/tic-tac-toe" },
  { name: "Snakes & Ladders", kind: "snakes-ladders", detail: "Climb high. Try not to slide back.", tag: "WILD RIDE", href: "/games/snakes-and-ladders" },
];

export default function HomePage() {
  return <main className="landing-page">
    <div className="landing-backdrop" aria-hidden="true"><span className="leaf-shape leaf-shape--one" /><span className="leaf-shape leaf-shape--two" /><span className="leaf-shape leaf-shape--three" /></div>
    <SiteHeader />
    <section className="hero-section">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEW FAVORITE HANGOUT</div>
        <h1>Good games.<br /><em>Good company.</em></h1>
        <p className="hero-description">A little friendly competition, a lot of laughing, and your favorite people around the board.</p>
        <div className="hero-actions">
          <Link className="button button--hero" href="/sign-up">Come on in <ArrowUpRight size={17} /></Link>
          <a className="quiet-link" href="#games">See what we play <ArrowDown size={15} /></a>
        </div>
        <div className="hero-proof"><span className="proof-stars" aria-hidden="true"><i>✦</i><i>✦</i><i>✦</i></span><span>A brighter kind of game night</span></div>
      </div>
      <div className="hero-visual" aria-label="A colorful Ludo board illustration">
        <div className="hero-glow" />
          <div className="hero-float hero-float--top"><span className="float-icon">✦</span><span><b>Play your way</b><small>Three classics in the works</small></span></div>
        <GameArtwork kind="ludo" />
          <div className="hero-float hero-float--bottom"><span className="float-check"><Check size={16} /></span><span><b>Made for good company</b><small>Games and social play are on the way.</small></span></div>
        <span className="hero-doodle hero-doodle--one">✳</span><span className="hero-doodle hero-doodle--two">✦</span>
      </div>
    </section>
    <div className="hero-ribbon"><span>GOOD VIBES</span><i>✳</i><span>CLASSIC GAMES</span><i>✳</i><span>FRIENDLY FACES</span><i>✳</i><span>GOOD VIBES</span></div>

    <section className="games-section" id="games">
      <div className="section-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> PICK YOUR PLAY</div><h2>Three classics.<br /><em>So many rematches.</em></h2></div>
        <p>Start with the games you know. Stay for the people you meet. More ways to play are on their way.</p>
      </div>
      <div className="game-cards">{games.map((game, index) => <a className={`game-card game-card--${game.kind}`} href={game.href} aria-label={`Play ${game.name} offline`} key={game.name}>
        <GameArtwork kind={game.kind} compact />
        <div className="game-card-copy"><span className="game-tag">{game.tag}</span><h3>{game.name}</h3><p>{game.detail}</p><span className="game-coming">PLAY OFFLINE <Sparkles size={13} /></span></div>
        <span className="game-card-index">0{index + 1}</span>
      </a>)}</div>
    </section>

    <section className="community-section" id="community">
      <div className="community-art" aria-hidden="true"><span className="community-token community-token--x">×</span><span className="community-token community-token--o">○</span><span className="community-stamp"><UsersRound size={25} /></span><span className="community-doodle">✳</span></div>
      <div className="community-copy"><div className="eyebrow eyebrow--light"><span className="eyebrow-dot" /> MORE THAN A SCOREBOARD</div><h2>Make room<br />for <em>your people.</em></h2><p>We’re building a place to find your crew, start a game, and turn “one more round” into the whole evening.</p><ul><li><Check size={16} /> Meet friends around the games</li><li><Check size={16} /> Keep your own player profile</li><li><Check size={16} /> Pick up where your crew left off</li></ul><Link className="button button--mint" href="/sign-up">Make it game night <ArrowRight size={16} /></Link></div>
    </section>

    <section className="closing-cta"><div className="closing-spark">✦</div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR SEAT IS WAITING</div><h2>Come for a game.<br /><em>Stay for the company.</em></h2><Link className="button button--hero" href="/sign-up">Join Rasmalai <ArrowUpRight size={17} /></Link></section>
    <footer className="site-footer">
      <div className="footer-brand"><span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span><span className="brand-name">rasmalai<span className="brand-period">.</span></span></div>
      <span className="footer-tagline">Made for people who like one more round.</span>
      <span className="footer-creator">Made with ❤️ by Kavyansh</span>
      <span className="footer-ghost" role="img" aria-label="Ghost">👻</span>
      <span className="footer-copyright">© 2026 Rasmalai</span>
      <Link className="footer-privacy-link" href="/privacy">Privacy Policy</Link>
    </footer>
  </main>;
}
