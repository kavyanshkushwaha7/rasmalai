"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Dices, RotateCcw, Sparkles } from "lucide-react";
import { CoinMotionOverlay, useCoinSequence, type CoinMoveRun } from "@/components/games/CoinSequence";
import { DiceFace } from "@/components/games/DiceFace";
import { GameSoundToggle } from "@/components/games/GameSoundToggle";
import { JesterCoin } from "@/components/games/JesterCoin";
import { PlayerSetup } from "@/components/games/PlayerSetup";
import { createLudoGame, getLegalLudoTokenIndexes, getLudoTrackIndex, LUDO_FINISHED, LUDO_HOME_LANES, LUDO_SAFE_TRACK_INDEXES, LUDO_START_INDEXES, LUDO_TRACK, LUDO_YARD_GRID, moveLudoToken, rollLudoDie, type LudoColor, type LudoState } from "@/lib/games/ludo";
import { getLudoCaptureReturnPoints, getLudoCapturedTokens, getLudoGridPoint, getLudoMoveSteps, getLudoProgressCell, getLudoYardPoint, type LudoMotionPoint } from "@/lib/games/ludo-token-motion";
import { createArcadeEventScope, playArcadeSound, unlockArcadeAudio } from "@/lib/games/arcade-audio";

const COLORS: Record<LudoColor, string> = { yellow: "gold", green: "mint", red: "coral", blue: "sky" };
const START_INDEX_COLORS: Record<number, "gold" | "mint" | "coral" | "sky"> = { [LUDO_START_INDEXES.yellow]: "gold", [LUDO_START_INDEXES.blue]: "sky", [LUDO_START_INDEXES.red]: "coral", [LUDO_START_INDEXES.green]: "mint" };
const HOME_LANES = LUDO_HOME_LANES;
const YARD_GRID = LUDO_YARD_GRID;
type TokenAt = { playerIndex: number; tokenIndex: number; color: LudoColor };
function rollDie() { return Math.floor(Math.random() * 6) + 1; }
function tokenLocation(progress: number) {
  if (progress < 0) return "In the yard";
  if (progress <= 50) return progress === 0 ? "Start square" : `Track step ${progress + 1}`;
  if (progress < LUDO_FINISHED) return `Home lane ${progress - 50}`;
  return "Home";
}

export function LudoGame() {
  const [state, setState] = useState<LudoState | null>(null);
  const [shownDie, setShownDie] = useState<number | null>(null);
  const [rollCount, setRollCount] = useState(0);
  const [motionRuns, setMotionRuns] = useState<CoinMoveRun[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const tokenPoints = useRef(new Map<string, LudoMotionPoint>());
  const movementSequence = useRef(0);
  const rollSoundSequence = useRef(0);
  const eventScope = useRef<string | null>(null);
  if (!eventScope.current) eventScope.current = createArcadeEventScope("offline:ludo");
  const completeMotion = useCallback((groupId: string) => setMotionRuns((current) => current.filter((run) => (run.groupId ?? run.id) !== groupId)), []);
  const { motion, bursts } = useCoinSequence(motionRuns, completeMotion);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    board.querySelectorAll<HTMLElement>("[data-ludo-token]").forEach((element) => {
      const rect = element.getBoundingClientRect();
      const id = element.dataset.ludoToken;
      if (!id) return;
      tokenPoints.current.set(id, { left: ((rect.left + rect.width / 2 - boardRect.left) / boardRect.width) * 100, top: ((rect.top + rect.height / 2 - boardRect.top) / boardRect.height) * 100 });
    });
  }, [state, motionRuns]);

  if (!state) return <PlayerSetup title="Bring your crew." description="Choose two to four human players. Pass the device after every turn." minPlayers={2} maxPlayers={4} initialCount={4} onStart={(names) => { setState(createLudoGame(names)); setShownDie(null); setRollCount(0); setMotionRuns([]); }} />;

  const current = state.players[state.turnIndex];
  const legal = getLegalLudoTokenIndexes(state);
  const hasWinner = state.winnerIndex !== null;
  const tokensByCell = new Map<string, TokenAt[]>();
  state.players.forEach((player, playerIndex) => player.tokens.forEach((progress, tokenIndex) => {
    if (progress < 0 || motionRuns.some((run) => run.playerIndex === playerIndex && run.tokenIndex === tokenIndex)) return;
    let cell: { row: number; col: number } | undefined;
    if (progress <= 50) cell = LUDO_TRACK[getLudoTrackIndex(player, progress)];
    else if (progress < LUDO_FINISHED) cell = HOME_LANES[player.color][progress - 51];
    else cell = { row: 7, col: 7 };
    if (!cell) return;
    const key = `${cell.row},${cell.col}`;
    tokensByCell.set(key, [...(tokensByCell.get(key) ?? []), { playerIndex, tokenIndex, color: player.color }]);
  }));

  function handleRoll() {
    if (motionRuns.length) return;
    const die = rollDie();
    unlockArcadeAudio();
    playArcadeSound(`${eventScope.current}:dice:${++rollSoundSequence.current}`, "dice");
    setShownDie(die);
    setRollCount((count) => count + 1);
    setState((currentState) => currentState ? rollLudoDie(currentState, die) : currentState);
  }

  function playToken(tokenIndex: number, source?: HTMLElement) {
    if (!state || motionRuns.length || state.pendingRoll === null || !legal.includes(tokenIndex)) return;
    const playerIndex = state.turnIndex;
    const player = state.players[playerIndex];
    const fromProgress = player.tokens[tokenIndex];
    const steps = getLudoMoveSteps(player, fromProgress, state.pendingRoll);
    const boardRect = boardRef.current?.getBoundingClientRect();
    const sourceRect = source?.getBoundingClientRect();
    const point = boardRect && sourceRect
      ? { left: ((sourceRect.left + sourceRect.width / 2 - boardRect.left) / boardRect.width) * 100, top: ((sourceRect.top + sourceRect.height / 2 - boardRect.top) / boardRect.height) * 100 }
      : tokenPoints.current.get(`${playerIndex}-${tokenIndex}`)
        ?? (fromProgress < 0 ? getLudoYardPoint(player, tokenIndex) : getLudoGridPoint(getLudoProgressCell(player, fromProgress)));
    const next = moveLudoToken(state, tokenIndex);
    setState(next);
    if (steps.length) {
      const id = `${eventScope.current}:move:${++movementSequence.current}`;
      const captures = getLudoCapturedTokens(state, next, playerIndex);
      const movement: CoinMoveRun = {
        id, groupId: id, playerIndex, tokenIndex, color: player.color, badge: String(tokenIndex + 1),
        start: { ...point, progress: fromProgress },
        steps: steps.map((step) => ({ ...getLudoGridPoint(step.cell), progress: step.progress })),
        ...(fromProgress === -1 ? { startCue: "unlock" as const } : {}),
        ...(next.winnerIndex === playerIndex && !captures.length ? { finalCue: "victory" as const } : {}),
      };
      const captureRuns: CoinMoveRun[] = captures.map((captured, index) => {
        const victim = state.players[captured.playerIndex];
        const from = getLudoGridPoint(getLudoProgressCell(victim, captured.fromProgress));
        const to = getLudoYardPoint(victim, captured.tokenIndex);
        return {
          id: `${id}:capture:${captured.playerIndex}:${captured.tokenIndex}`, groupId: id,
          playerIndex: captured.playerIndex, tokenIndex: captured.tokenIndex, color: victim.color,
          badge: String(captured.tokenIndex + 1), kind: "capture", startCue: "capture",
          start: { ...from, progress: captured.fromProgress }, steps: [],
          capturePath: getLudoCaptureReturnPoints(from, to).map((point) => ({ ...point })),
          ...(next.winnerIndex === playerIndex && index === captures.length - 1 ? { finalCue: "victory" as const } : {}),
        };
      });
      setMotionRuns([movement, ...captureRuns]);
    }
  }

  function renderStack(row: number, col: number) {
    if (!state) return null;
    const tokens = tokensByCell.get(`${row},${col}`) ?? [];
    return <span className={`ludo-token-stack ${tokens.length === 1 ? "is-single" : ""}`}>{tokens.map((token) => {
      const player = state.players[token.playerIndex];
      const canMove = token.playerIndex === state.turnIndex && legal.includes(token.tokenIndex);
      const isMoving = motionRuns.some((run) => run.playerIndex === token.playerIndex && run.tokenIndex === token.tokenIndex);
      return <button className={`ludo-token ludo-token--${COLORS[token.color]} ${canMove ? "is-legal" : ""} ${isMoving ? "is-moving" : ""}`} data-ludo-token={`${token.playerIndex}-${token.tokenIndex}`} type="button" key={`${token.playerIndex}-${token.tokenIndex}`} disabled={!canMove} aria-label={`${player.name}, token ${token.tokenIndex + 1}, ${tokenLocation(player.tokens[token.tokenIndex])}${canMove ? ", move token" : ""}`} onClick={(event) => playToken(token.tokenIndex, event.currentTarget)}><JesterCoin color={token.color} /><span className="ludo-token-index">{token.tokenIndex + 1}</span></button>;
    })}</span>;
  }

  function restart() {
    if (!state) return;
    setState(createLudoGame(state.players.map((player) => player.name)));
    setShownDie(null);
    setRollCount(0);
    setMotionRuns([]);
  }

  return <div className="ludo-experience">
    <div className="ludo-player-panels" aria-label="Players and turn status">
      {state.players.map((player, index) => <div className={`ludo-player-card ludo-player-card--${COLORS[player.color]} ${state.turnIndex === index && !hasWinner ? "is-current" : ""}`} key={player.color}>
        <JesterCoin color={player.color} className="ludo-player-avatar" />
        <span className="ludo-player-copy"><strong>{player.name}</strong><small>{state.turnIndex === index && !hasWinner ? "Your turn" : `${player.tokens.filter((progress) => progress === LUDO_FINISHED).length}/4 home`}</small></span>
        {state.turnIndex === index && !hasWinner && <span className="ludo-turn-indicator"><Sparkles size={14} /> TURN</span>}
      </div>)}
    </div>
    <div className="ludo-game-layout">
      <section className="game-board-card ludo-board-card" aria-label="Ludo board">
        <div className="ludo-board-topline"><span className="eyebrow">FOUR TOKENS · FIRST ALL-HOME WINS</span><span className="ludo-safe-legend"><i>✦</i> Safe</span></div>
        {hasWinner && <div className="ludo-winner-ribbon" role="status"><span aria-hidden="true">✦</span><strong>{state.players[state.winnerIndex!].name} wins the round!</strong><span aria-hidden="true">✦</span></div>}
        <div className="ludo-board-frame">
          <div ref={boardRef} className="ludo-board" role="grid" aria-label="Ludo board with four colored home yards, 52 shared squares and home lanes">
            {(Object.entries(YARD_GRID) as [LudoColor, { row: number; col: number }][]).map(([color, position]) => {
              const playerIndex = state.players.findIndex((player) => player.color === color);
              if (playerIndex < 0) return <div className={`ludo-yard ludo-yard--${COLORS[color]} ludo-yard--unused`} key={color} style={{ gridRow: `${position.row + 1} / span 6`, gridColumn: `${position.col + 1} / span 6` }} aria-label={`${color} open yard, no player assigned`}>
                <strong>Open yard</strong><span className="ludo-yard-color">{color}</span>
                <div className="ludo-yard-token-grid" aria-hidden="true">{[1, 2, 3, 4].map((token) => <i className={`ludo-yard-ghost-token ludo-yard-token--${COLORS[color]}`} key={token}>{token}</i>)}</div>
              </div>;
              const player = state.players[playerIndex];
              return <div className={`ludo-yard ludo-yard--${COLORS[color]}`} key={color} style={{ gridRow: `${position.row + 1} / span 6`, gridColumn: `${position.col + 1} / span 6` }}>
                <strong>{player.name}</strong><span className="ludo-yard-color">{color}</span>
                <div className="ludo-yard-token-grid">{player.tokens.map((progress, tokenIndex) => {
                  if (progress >= 0 || motionRuns.some((run) => run.playerIndex === playerIndex && run.tokenIndex === tokenIndex)) return <span className="ludo-yard-token-slot" key={tokenIndex} aria-hidden="true" />;
                  const canMove = playerIndex === state.turnIndex && legal.includes(tokenIndex) && !motionRuns.length;
                  return <button className={`ludo-yard-token ludo-yard-token--${COLORS[color]} ${canMove ? "is-legal" : ""}`} data-ludo-token={`${playerIndex}-${tokenIndex}`} type="button" key={tokenIndex} disabled={!canMove} aria-label={`${player.name}, token ${tokenIndex + 1}, ${tokenLocation(progress)}${canMove ? ", move token" : ""}`} onClick={(event) => playToken(tokenIndex, event.currentTarget)}><JesterCoin color={color} /><span className="ludo-token-index">{tokenIndex + 1}</span></button>;
                })}</div>
              </div>;
            })}
            {LUDO_TRACK.map((cell, index) => <div className={`ludo-board-cell ludo-track-cell ${LUDO_SAFE_TRACK_INDEXES.has(index) ? "is-safe" : ""} ${START_INDEX_COLORS[index] ? `ludo-track-cell--${START_INDEX_COLORS[index]}` : ""}`} data-ludo-cell={`${cell.row}-${cell.col}`} key={`track-${index}`} style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }} aria-label={`Track square ${index + 1}${LUDO_SAFE_TRACK_INDEXES.has(index) ? ", safe" : ""}${START_INDEX_COLORS[index] ? ", player start" : ""}`}>{LUDO_SAFE_TRACK_INDEXES.has(index) && <span className="ludo-star">✦</span>}{renderStack(cell.row, cell.col)}</div>)}
            {(Object.entries(HOME_LANES) as [LudoColor, Array<{ row: number; col: number }>][]) .flatMap(([color, lane]) => lane.map((cell, laneIndex) => <div className={`ludo-board-cell ludo-home-cell ludo-home-cell--${COLORS[color]}`} data-ludo-cell={`${cell.row}-${cell.col}`} key={`${color}-home-${laneIndex}`} style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }} aria-label={`${color} home path, step ${laneIndex + 1}`}>{renderStack(cell.row, cell.col)}</div>))}
            <div className="ludo-finish-cell" data-ludo-cell="7-7" style={{ gridRow: 8, gridColumn: 8 }} aria-label="Home finish">{renderStack(7, 7)}<span aria-hidden="true">HOME</span></div>
            <CoinMotionOverlay motion={motion} bursts={bursts} className="ludo-moving-coin" />
          </div>
        </div>
      </section>
      <aside className="game-side-panel ludo-controls">
        <div className="ludo-control-heading"><span className="eyebrow">{hasWinner ? "GAME COMPLETE" : "CURRENT TURN"}</span><h2>{hasWinner ? `${state.players[state.winnerIndex!].name} wins!` : current.name}</h2></div>
        <div className={`ludo-dice-dock ludo-dice-dock--${COLORS[current.color]}`} key={rollCount}><DiceFace value={shownDie} className="ludo-dice" /><span>{shownDie ? `Rolled ${shownDie}` : "Ready to roll"}</span></div>
        <p className="game-feedback" aria-live="polite">{state.message}</p>
        <GameSoundToggle />
        {!hasWinner && <button className={`button ludo-roll-button ${state.pendingRoll === null && !motionRuns.length ? "is-your-turn" : ""}`} type="button" onClick={handleRoll} disabled={state.pendingRoll !== null || !!motionRuns.length}><Dices size={17} /> {state.pendingRoll === null ? "Roll the dice" : `Rolled ${state.pendingRoll}`}</button>}
        {!hasWinner && state.pendingRoll !== null && <div className="ludo-token-choices"><span className="eyebrow">CHOOSE A TOKEN · {legal.length} LEGAL</span>{current.tokens.map((progress, tokenIndex) => {
          const canMove = legal.includes(tokenIndex) && !motionRuns.length;
          return <button type="button" className={`ludo-choice-button ${canMove ? "is-legal" : ""}`} key={tokenIndex} disabled={!canMove} onClick={() => playToken(tokenIndex)}><JesterCoin color={current.color} className="ludo-choice-coin" /><span className="ludo-choice-index">{tokenIndex + 1}</span><span>Token {tokenIndex + 1}</span><small>{tokenLocation(progress)}</small></button>;
        })}</div>}
        {hasWinner && <button className="button ludo-roll-button" type="button" onClick={restart} disabled={!!motionRuns.length}><RotateCcw size={16} /> Play again</button>}
        {!hasWinner && <button className="button button--soft game-new-button" type="button" onClick={restart} disabled={!!motionRuns.length}><RotateCcw size={15} /> Restart</button>}
        <button className="button button--soft game-new-button" type="button" onClick={() => { setState(null); setShownDie(null); setMotionRuns([]); }} disabled={!!motionRuns.length}>New players</button>
        <details className="game-rules"><summary>How classic Ludo works</summary><ul><li>Roll a six to launch a token. Any six grants another turn.</li><li>Choose one legal token after rolling. All highlighted board tokens can be tapped directly.</li><li>Star squares and all four start squares are safe. Landing on opponents on other shared squares sends them to their yard.</li><li>Exact rolls are needed to finish. The first player to bring all four tokens home wins. Friendly stacks do not block; there is no three-sixes penalty.</li></ul></details>
      </aside>
    </div>
  </div>;
}
