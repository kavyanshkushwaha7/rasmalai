export type GameKind = "ludo" | "tic-tac-toe" | "snakes-ladders";

export function GameArtwork({ kind, compact = false }: { kind: GameKind; compact?: boolean }) {
  if (kind === "ludo") {
    return (
      <div className={`game-art game-art--ludo ${compact ? "game-art--compact" : ""}`} aria-hidden="true">
        <div className="ludo-board">
          <div className="ludo-home ludo-home--red"><i /><i /><i /><i /></div>
          <div className="ludo-home ludo-home--green"><i /><i /><i /><i /></div>
          <div className="ludo-home ludo-home--blue"><i /><i /><i /><i /></div>
          <div className="ludo-home ludo-home--gold"><i /><i /><i /><i /></div>
          <div className="ludo-center"><b /><b /><b /><b /></div>
        </div>
        <span className="art-spark art-spark--one">✦</span><span className="art-spark art-spark--two">✦</span>
      </div>
    );
  }
  if (kind === "tic-tac-toe") {
    return (
      <div className={`game-art game-art--tic ${compact ? "game-art--compact" : ""}`} aria-hidden="true">
        <div className="tic-grid"><b>×</b><b>○</b><b>×</b><b>○</b><b>×</b><b>○</b><b>×</b><b>○</b><b>×</b></div>
        <span className="tic-orb tic-orb--pink" /><span className="tic-orb tic-orb--mint" />
      </div>
    );
  }
  return (
    <div className={`game-art game-art--snakes ${compact ? "game-art--compact" : ""}`} aria-hidden="true">
      <div className="snakes-grid">
        {Array.from({ length: 25 }, (_, index) => <i key={index}>{25 - index}</i>)}
      </div>
      <svg className="ladder-drawing" viewBox="0 0 180 120" fill="none" aria-hidden="true">
        <path d="M38 106 122 18M54 113l84-88M49 96l17 16M64 80l17 16M79 64l17 16M94 48l17 16M109 32l17 16" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      </svg>
      <svg className="snake-drawing" viewBox="0 0 180 120" fill="none" aria-hidden="true">
        <path d="M18 20c44-10 35 42 77 39 39-3 24-45 60-39 23 4 18 30-4 30-15 0-17-12-8-17" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        <circle cx="148" cy="18" r="2.5" fill="#10382D" /><circle cx="157" cy="18" r="2.5" fill="#10382D" />
      </svg>
      <span className="snakes-token">7</span>
    </div>
  );
}
