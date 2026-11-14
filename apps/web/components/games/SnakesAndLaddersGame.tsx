"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Dices, RotateCcw, Star } from "lucide-react";
import { DiceFace } from "@/components/games/DiceFace";
import { CoinMotionOverlay, useCoinSequence, type CoinMoveRun } from "@/components/games/CoinSequence";
import { GameSoundToggle } from "@/components/games/GameSoundToggle";
import { JesterCoin, JesterCoinArtwork, type JesterCoinColor } from "@/components/games/JesterCoin";
import { PlayerSetup } from "@/components/games/PlayerSetup";
import { createArcadeEventScope, playArcadeSound, unlockArcadeAudio } from "@/lib/games/arcade-audio";
import { createSnakesAndLaddersGame, getSnakesBoardCell, LADDERS, rollSnakesAndLadders, SNAKES, type SnakesAndLaddersState } from "@/lib/games/snakes-and-ladders";
import { getSnakesMoveAnimationPlan, getSnakesTokenPlacements } from "@/lib/games/snakes-token-layout";
import { getLadderRouteGeometry, getSnakeRouteGeometry, getSnakesSquareCenter } from "@/lib/games/snakes-route-geometry";

const PLAYER_COLORS = ["coral", "mint", "sky", "gold"] as const;
const TOKEN_COLORS: readonly JesterCoinColor[] = ["red", "green", "blue", "yellow"];
function rollDie() { return Math.floor(Math.random() * 6) + 1; }

export function SnakesAndLaddersGame() {
  const [state, setState] = useState<SnakesAndLaddersState | null>(null);
  const [rollCount, setRollCount] = useState(0);
  const [motionRuns, setMotionRuns] = useState<CoinMoveRun[]>([]);
  const moveSequence = useRef(0);
  const rollSoundSequence = useRef(0);
  const eventScope = useRef<string | null>(null);
  if (!eventScope.current) eventScope.current = createArcadeEventScope("offline:snakes");
  const completeMotion = useCallback((id: string) => setMotionRuns((currentRuns) => currentRuns.filter((run) => run.id !== id)), []);
  const { motion, bursts } = useCoinSequence(motionRuns, completeMotion);

  if (!state) return <PlayerSetup title="Gather your players." description="Choose two to four names. Everyone shares the same board and takes one roll per turn." minPlayers={2} maxPlayers={4} initialCount={2} onStart={(names) => { setState(createSnakesAndLaddersGame(names)); setRollCount(0); setMotionRuns([]); }} />;

  const current = state.players[state.turnIndex];
  const lastMove = state.lastMove;
  const lastPlayer = lastMove ? state.players[lastMove.playerIndex].name : "The current player";
  const detail = state.winnerIndex !== null
    ? `${state.players[state.winnerIndex].name} reached square 100 and wins!`
    : !lastMove ? "Roll the die to begin." : lastMove.landed > 100
      ? `${lastPlayer} rolled ${lastMove.rolled}; exact finish needed, so they stay on ${lastMove.from}.`
      : lastMove.transport === "ladder" ? `Ladder! Up from ${lastMove.landed} to ${lastMove.final}.`
        : lastMove.transport === "snake" ? `Snake! Down from ${lastMove.landed} to ${lastMove.final}.`
          : `${lastPlayer} rolled ${lastMove.rolled} and moved to ${lastMove.final}.`;

  function handleRoll() {
    if (!state || motionRuns.length) return;
    unlockArcadeAudio();
    playArcadeSound(`${eventScope.current}:dice:${++rollSoundSequence.current}`, "dice");
    const die = rollDie();
    const next = rollSnakesAndLadders(state, die);
    setRollCount((count) => count + 1);
    setState(next);
    const move = next.lastMove;
    const plan = move ? getSnakesMoveAnimationPlan(move) : null;
    if (plan?.steps.length && move) {
      const pointFor = (square: number) => {
        if (square === 0) return { left: 5, top: 105, square };
        const cell = getSnakesBoardCell(square);
        return { left: (cell.col + .5) * 10, top: (cell.row + .5) * 10, square };
      };
      setMotionRuns([{
        id: `${eventScope.current}:move:${++moveSequence.current}`, playerIndex: move.playerIndex, color: TOKEN_COLORS[move.playerIndex],
        start: pointFor(move.from), steps: plan.steps.map(pointFor),
        ...(plan.transportPath && move.transport ? { transport: {
          kind: move.transport,
          destination: pointFor(move.final),
          points: plan.transportPoints.map((point, index) => ({ left: point.x / 10, top: point.y / 10, square: index === 0 ? move.landed : index === plan.transportPoints.length - 1 ? move.final : undefined })),
          durationMs: move.transport === "snake" ? 1080 : 900,
        } } : {}),
        ...(next.winnerIndex === move.playerIndex ? { finalCue: "victory" as const } : {}),
      }]);
    }
  }

  function restart() {
    if (!state) return;
    setState(createSnakesAndLaddersGame(state.players.map((player) => player.name)));
    setRollCount(0);
    setMotionRuns([]);
  }

  return <div className="snakes-experience">
    <div className="snakes-space-banner"><div><span>MISSION 01 · COSMIC TRAIL</span><strong>Reach the rainbow.</strong></div><span className="snakes-banner-star" aria-hidden="true"><Star /></span></div>
    <div className="game-play-layout snakes-game-layout">
      <section className="game-board-card snakes-board-card" aria-label="Snakes and Ladders board">
        <div className="snakes-board-topline"><span className="eyebrow">SQUARES 1–100</span><span className="snakes-board-legend"><span><ArrowUp size={14} /> Ladder</span><span><ArrowDown size={14} /> Snake</span></span></div>
        {state.winnerIndex !== null && <div className="snakes-winner-ribbon" role="status"><span aria-hidden="true">✦</span><strong>{state.players[state.winnerIndex].name} reached 100!</strong><span aria-hidden="true">✦</span></div>}
        <div className="snakes-board" role="grid" aria-label="Numbered Snakes and Ladders board">
          {Array.from({ length: 100 }, (_, index) => index + 1).map((square) => {
            const { row, col } = getSnakesBoardCell(square);
            const ladder = LADDERS[square];
            const snake = SNAKES[square];
            return <div className={`snakes-square ${((square + Math.floor((square - 1) / 10)) % 2) ? "snakes-square--shade" : ""} ${ladder ? "snakes-square--ladder" : ""} ${snake ? "snakes-square--snake" : ""}`} key={square} role="gridcell" aria-label={`Square ${square}${ladder ? `, ladder to ${ladder}` : snake ? `, snake to ${snake}` : ""}`} style={{ gridRow: row + 1, gridColumn: col + 1 }}>
              <span className="snakes-square-number">{square}</span>
            </div>;
          })}
          <svg className="snakes-route-art" viewBox="0 0 1000 1000" aria-hidden="true">
            {Object.entries(LADDERS).map(([startText, end]) => {
              const start = Number(startText);
              const parts = getLadderRouteGeometry(start, end);
              const active = motion?.phase === "transport" && motion.run.transport?.kind === "ladder" && motion.run.steps.at(-1)?.square === start && motion.run.transport.destination.square === end;
              return <g className={`snakes-route snakes-ladder${active ? " is-active" : ""}`} key={`ladder-${start}`}>
                <title>{`Ladder from square ${start} to ${end}`}</title>
                <path className="ladder-rail-shadow" d={parts.left} /><path className="ladder-rail-shadow" d={parts.right} />
                <path className="ladder-rail" d={parts.left} /><path className="ladder-rail" d={parts.right} />
                {parts.rungs.map((rung, index) => <path className="ladder-rung" d={rung} key={index} />)}
              </g>;
            })}
            {Object.entries(SNAKES).map(([headText, tail], index) => {
              const head = Number(headText);
              const start = getSnakesSquareCenter(head);
              const end = getSnakesSquareCenter(tail);
              const path = getSnakeRouteGeometry(head, tail).path;
              const active = motion?.phase === "transport" && motion.run.transport?.kind === "snake" && motion.run.steps.at(-1)?.square === head && motion.run.transport.destination.square === tail;
              return <g className={`snakes-route snakes-serpent snakes-serpent--${index}${active ? " is-active" : ""}`} key={`snake-${head}`}>
                <title>{`Snake head on square ${head}, tail on square ${tail}`}</title>
                <path className="serpent-outline" d={path} />
                <path className="serpent-body" d={path} />
                <path className="serpent-belly" d={path} />
                <circle className="serpent-head" cx={start.x} cy={start.y} r="31" />
                <circle className="serpent-eye" cx={start.x - 9} cy={start.y - 7} r="8" /><circle className="serpent-eye" cx={start.x + 9} cy={start.y - 7} r="8" />
                <circle className="serpent-pupil" cx={start.x - 7} cy={start.y - 7} r="3.5" /><circle className="serpent-pupil" cx={start.x + 11} cy={start.y - 7} r="3.5" />
                <path className="serpent-tongue" d={`M ${start.x} ${start.y + 17} l 0 13 m 0 -2 -7 8 m 7 -8 7 8`} />
                <path className="serpent-tail" d={`M ${end.x - 10} ${end.y} l 20 -7 -3 14 Z`} />
              </g>;
            })}
          </svg>
          <svg className="snakes-token-layer" viewBox="0 0 1000 1000" aria-hidden="true">
            {getSnakesTokenPlacements(state.players.map((player) => player.position), motionRuns.map((run) => run.playerIndex ?? -1)).map((token) => <svg key={token.playerIndex} x={token.x - token.size / 2} y={token.y - token.size / 2} width={token.size} height={token.size} viewBox="0 0 100 100" className={`snakes-static-token${state.turnIndex === token.playerIndex ? " is-current" : ""}`}><title>{`${state.players[token.playerIndex].name} on square ${token.square}`}</title><JesterCoinArtwork color={TOKEN_COLORS[token.playerIndex]} /></svg>)}
          </svg>
          <CoinMotionOverlay motion={motion} bursts={bursts} className="snakes-moving-token" layerClassName="coin-motion-layer--snakes" />
        </div>
        <div className="snakes-player-positions" aria-label="Player positions">{state.players.map((player, index) => <div className={`snakes-position snakes-position--${PLAYER_COLORS[index]} ${state.turnIndex === index && state.winnerIndex === null ? "is-current" : ""}`} key={index}><JesterCoin color={TOKEN_COLORS[index]} className="snakes-player-token" /><span><strong>{player.name}</strong><small>{player.position === 0 ? "At the start" : `Square ${player.position}`}</small></span></div>)}</div>
      </section>
      <aside className="game-side-panel snakes-controls">
        <div className="snakes-turn-banner"><span className="eyebrow">{state.winnerIndex === null ? "CURRENT TURN" : "MISSION COMPLETE"}</span><h2>{state.winnerIndex === null ? current.name : `${state.players[state.winnerIndex].name} wins!`}</h2></div>
        <div className="snakes-dice-dock" key={rollCount}><DiceFace value={lastMove?.rolled ?? null} className="snakes-dice" /><span>{lastMove ? `Rolled ${lastMove.rolled}` : "Ready to roll"}</span></div>
        <p className="game-feedback" aria-live="polite">{detail}</p>
        <GameSoundToggle />
        {state.winnerIndex === null
          ? <button className={`button snakes-roll-button ${!motionRuns.length ? "is-your-turn" : ""}`} type="button" onClick={handleRoll} disabled={!!motionRuns.length}><Dices size={17} /> Roll the die</button>
          : <button className="button snakes-roll-button" type="button" onClick={restart} disabled={!!motionRuns.length}><RotateCcw size={16} /> Play again</button>}
        {state.winnerIndex === null && <button className="button button--soft game-new-button" type="button" onClick={restart} disabled={!!motionRuns.length}><RotateCcw size={15} /> Restart</button>}
        <button className="button button--soft game-new-button" type="button" onClick={() => { setState(null); setRollCount(0); setMotionRuns([]); }} disabled={!!motionRuns.length}>New players</button>
        <ol className="game-player-list snakes-turn-list">{state.players.map((player, index) => <li className={state.turnIndex === index && state.winnerIndex === null ? "is-current" : ""} key={index}><JesterCoin color={TOKEN_COLORS[index]} className="snakes-player-token" /><span>{player.name}</span><span className="turn-pill">{player.position === 0 ? "Start" : player.position === 100 ? "Home" : player.position}</span></li>)}</ol>
        <details className="game-rules"><summary>Space trail rules</summary><p>Reach square 100 from the start. Land at a ladder's foot to climb or on a snake's head to slide. Overshooting 100 leaves you in place and ends your turn. Sixes do not grant an extra turn.</p></details>
      </aside>
    </div>
  </div>;
}
