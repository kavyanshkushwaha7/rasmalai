"use client";

import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { PlayerSetup } from "@/components/games/PlayerSetup";
import { GameSoundToggle } from "@/components/games/GameSoundToggle";
import { createTicTacToeGame, getTicTacToeWinningLine, playTicTacToeMove, type TicTacToeState } from "@/lib/games/tic-tac-toe";
import { createArcadeEventScope, playArcadeSound, unlockArcadeAudio } from "@/lib/games/arcade-audio";

const PARTICLES = Array.from({ length: 14 }, (_, index) => index);

export function TicTacToeGame() {
  const [state, setState] = useState<TicTacToeState | null>(null);
  const moveSequence = useRef(0);
  const roundId = useRef("");

  function startRound(names: [string, string]) {
    roundId.current = createArcadeEventScope("offline:tic");
    moveSequence.current = 0;
    setState(createTicTacToeGame(names));
  }

  function playCell(cell: number) {
    if (!state || state.winnerIndex !== null || state.isDraw || state.board[cell] !== null) return;
    const next = playTicTacToeMove(state, cell);
    const cueId = `${roundId.current || "offline:tic:round"}:move:${++moveSequence.current}`;
    unlockArcadeAudio();
    setState(next);
    playArcadeSound(`${cueId}:place`, "place");
    if (next.winnerIndex !== null) playArcadeSound(`${cueId}:victory`, "victory");
    else if (next.isDraw) playArcadeSound(`${cueId}:draw`, "draw");
  }

  if (!state) return <PlayerSetup title="Who’s playing?" description="Choose two names. X takes the first turn." minPlayers={2} maxPlayers={2} onStart={(names) => startRound([names[0], names[1]])} />;

  const isOver = state.winnerIndex !== null || state.isDraw;
  const currentMark = state.turnIndex === 0 ? "X" : "O";
  const winningLine = state.winnerIndex !== null ? getTicTacToeWinningLine(state.board) : null;
  const message = state.winnerIndex !== null
    ? `${state.players[state.winnerIndex]} wins!`
    : state.isDraw ? "It’s a draw!" : `${state.players[state.turnIndex]}’s turn · ${currentMark}`;
  const first = winningLine?.[0];
  const last = winningLine?.[2];
  const line = first === undefined || last === undefined ? null : {
    x1: ((first % 3) * 100) + 50,
    y1: (Math.floor(first / 3) * 100) + 50,
    x2: ((last % 3) * 100) + 50,
    y2: (Math.floor(last / 3) * 100) + 50,
  };

  return <div className="tic-experience">
    <div className="tic-player-panels" aria-label="Players">
      {state.players.map((player, index) => <div className={`tic-player-card tic-player-card--${index === 0 ? "x" : "o"} ${state.turnIndex === index && !isOver ? "is-current" : ""}`} key={player}>
        <span className={`tic-player-symbol tic-player-symbol--${index === 0 ? "x" : "o"}`}>{index === 0 ? "×" : "○"}</span>
        <span><strong>{player}</strong><small>{state.winnerIndex === index ? "Winner" : state.turnIndex === index && !isOver ? "Your turn" : index === 0 ? "Plays X" : "Plays O"}</small></span>
      </div>)}
    </div>
    <div className="game-play-layout tic-game-layout">
      <section className={`game-board-card tic-board-card ${isOver ? "is-complete" : ""}`} aria-label="Tic Tac Toe board">
        <div className="tic-status" aria-live="polite"><span className={`tic-mark tic-mark--${currentMark.toLowerCase()}`}>{isOver ? <Sparkles size={19} /> : currentMark}</span><div><span className="eyebrow">{state.winnerIndex !== null ? "ROUND COMPLETE" : state.isDraw ? "ROUND COMPLETE" : "YOUR TURN"}</span><h2>{message}</h2></div></div>
        {state.winnerIndex !== null && <div className="tic-winner-ribbon"><Sparkles size={18} /><strong>{state.players[state.winnerIndex]} takes the round!</strong><Sparkles size={18} /></div>}
        {state.isDraw && <div className="tic-winner-ribbon tic-winner-ribbon--draw"><strong>Even match · play again?</strong></div>}
        <div className="tic-board-stage">
          {state.winnerIndex !== null && <div className="tic-particle-burst" aria-hidden="true">{PARTICLES.map((particle) => <i key={particle} style={{ "--particle-angle": `${particle * 25}deg`, "--particle-delay": `${particle * 14}ms`, "--particle-color": `hsl(${particle * 25} 100% 75%)` } as CSSProperties}>{particle % 3 === 0 ? "✦" : particle % 3 === 1 ? "✧" : "•"}</i>)}</div>}
          <div className="tic-play-board" role="grid" aria-label="3 by 3 Tic Tac Toe board">
            {line && <svg className="tic-winning-line" viewBox="0 0 300 300" aria-hidden="true"><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} pathLength="1" /></svg>}
            {state.board.map((mark, index) => <button
              key={index}
              className={`tic-play-cell ${mark ? `tic-play-cell--${mark.toLowerCase()}` : ""} ${winningLine?.some((cell) => cell === index) ? "is-winning" : ""}`}
              type="button"
              role="gridcell"
              disabled={isOver || mark !== null}
              aria-label={`Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}: ${mark ?? "empty"}${!isOver && mark === null ? `, play ${currentMark}` : ""}`}
              onClick={() => playCell(index)}
            >{mark}</button>)}
          </div>
        </div>
        <div className="game-action-row tic-actions">
          {isOver && <button className="button tic-play-again" type="button" onClick={() => startRound(state.players)}><Sparkles size={16} /> Play again</button>}
          {!isOver && <button className="button button--soft" type="button" onClick={() => startRound(state.players)}><RotateCcw size={15} /> Restart</button>}
          <button className="button button--soft" type="button" onClick={() => { roundId.current = ""; setState(null); }}>New players</button>
        </div>
      </section>
      <aside className="game-side-panel tic-side-panel">
        <GameSoundToggle />
        <div className="game-side-heading"><span className="eyebrow">MATCH STATUS</span><h2>{state.isDraw ? "Good game." : state.winnerIndex !== null ? "A bright victory." : "Take turns."}</h2></div>
        <ol className="game-player-list">{state.players.map((name, index) => <li className={state.turnIndex === index && !isOver ? "is-current" : ""} key={name}><span className={`tic-mark tic-mark--${index === 0 ? "x" : "o"}`}>{index === 0 ? "×" : "○"}</span><span>{name}</span><span className="turn-pill">{state.winnerIndex === index ? "Winner" : state.turnIndex === index && !isOver ? "Playing" : ""}</span></li>)}</ol>
        <details className="game-rules"><summary>How to play</summary><p>Players take turns filling an empty square. The first to get three marks in a row, column, or diagonal wins. If all nine squares fill without a line, the round is a draw.</p></details>
        {isOver && <p className="game-result-note" aria-live="polite">{state.winnerIndex !== null ? `${state.players[state.winnerIndex]} took the round.` : "No three-in-a-row this time."}</p>}
      </aside>
    </div>
  </div>;
}
