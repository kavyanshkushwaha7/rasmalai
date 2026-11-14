"use client";

import { useCallback, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Dices, Sparkles } from "lucide-react";
import { CoinMotionOverlay, useCoinSequence, type CoinMoveRun } from "@/components/games/CoinSequence";
import { DiceFace } from "@/components/games/DiceFace";
import { GameSoundToggle } from "@/components/games/GameSoundToggle";
import { JesterCoin, JesterCoinArtwork, type JesterCoinColor } from "@/components/games/JesterCoin";
import { getSnakesTokenPlacements } from "@/lib/games/snakes-token-layout";
import { getLudoCaptureReturnPoints, getLudoGridPoint, getLudoProgressCell, getLudoYardPoint } from "@/lib/games/ludo-token-motion";
import { getLegalLudoTokenIndexes, getLudoTrackIndex, LUDO_FINISHED, LUDO_HOME_LANES, LUDO_SAFE_TRACK_INDEXES, LUDO_START_INDEXES, LUDO_TRACK, LUDO_YARD_GRID, type LudoColor, type LudoState } from "@rasmalai/game-engine/ludo";
import { getSnakesBoardCell, LADDERS, SNAKES, type SnakesAndLaddersState } from "@rasmalai/game-engine/snakes-and-ladders";
import { getTicTacToeWinningLine, type TicTacToeState } from "@rasmalai/game-engine/tic-tac-toe";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import type { OnlineRollCue, OnlineLudoMoveAnimation, OnlineMoveAnimation, OnlineSnakesMoveAnimation } from "@/lib/games/online-move-animation";
import { getLadderRouteGeometry, getSnakeRouteGeometry, getSnakesSquareCenter } from "@/lib/games/snakes-route-geometry";

const TOKEN_CLASS: Record<LudoColor, string> = { yellow: "gold", green: "mint", red: "coral", blue: "sky" };
const START_CLASS: Record<number, string> = { [LUDO_START_INDEXES.yellow]: "gold", [LUDO_START_INDEXES.blue]: "sky", [LUDO_START_INDEXES.red]: "coral", [LUDO_START_INDEXES.green]: "mint" };
const SNAKE_PLAYER_COLORS = ["coral", "mint", "sky", "gold"] as const;
const SNAKE_TOKEN_COLORS: readonly JesterCoinColor[] = ["red", "green", "blue", "yellow"];
const PARTICLES = Array.from({ length: 14 }, (_, index) => index);
type Cell = { row: number; col: number };
type BoardAction = (action: { type: "roll" } | { type: "move"; cell?: number; tokenIndex?: number }) => void;

type CompleteMoveAnimation = (id: string) => void;
const noopCompleteMoveAnimation: CompleteMoveAnimation = () => {};
const noopReconnect = () => {};

function LudoBoard({ room, userId, onAction, moveAnimations, onMoveAnimationComplete, diceRollAnimationId, diceRollResult, realtimeConnected, actionBusy, pendingActionType, rollRetryAvailable, onReconnect }: { room: OnlineRoomSnapshot; userId: string; onAction: BoardAction; moveAnimations: OnlineMoveAnimation[]; onMoveAnimationComplete: CompleteMoveAnimation; diceRollAnimationId: string | null; diceRollResult: OnlineRollCue | null; realtimeConnected: boolean; actionBusy: boolean; pendingActionType: "roll" | "move" | null; rollRetryAvailable: boolean; onReconnect: () => void }) {
  const state = room.state as LudoState;
  const ludoMoves = moveAnimations.filter((event): event is OnlineLudoMoveAnimation => event.gameType === "LUDO" && event.matchId === room.matchId);
  const motionRuns: CoinMoveRun[] = ludoMoves.flatMap((event) => {
    const player = state.players[event.playerIndex];
    if (!player) return [];
    const start = event.fromProgress < 0 ? getLudoYardPoint(player, event.tokenIndex) : getLudoGridPoint(getLudoProgressCell(player, event.fromProgress));
    const movement: CoinMoveRun = {
      id: event.id, groupId: event.id, playerIndex: event.playerIndex, tokenIndex: event.tokenIndex,
      color: event.color, badge: String(event.tokenIndex + 1), start: { ...start, progress: event.fromProgress },
      steps: event.steps.map((step) => ({ ...getLudoGridPoint(step.cell), progress: step.progress })),
      ...(event.unlocked ? { startCue: "unlock" as const } : {}),
      ...(event.won && !event.captures.length ? { finalCue: "victory" as const } : {}),
    };
    const captures = event.captures.flatMap((captured, index) => {
      const victim = state.players[captured.playerIndex];
      if (!victim) return [];
      const from = getLudoGridPoint(getLudoProgressCell(victim, captured.fromProgress));
      const to = getLudoYardPoint(victim, captured.tokenIndex);
      const capturePath = getLudoCaptureReturnPoints(from, to).map((point) => ({ ...point, progress: undefined }));
      return [{
        id: `${event.id}:capture:${captured.playerIndex}:${captured.tokenIndex}`,
        groupId: event.id, playerIndex: captured.playerIndex, tokenIndex: captured.tokenIndex,
        color: victim.color, badge: String(captured.tokenIndex + 1), kind: "capture" as const,
        startCue: "capture" as const, start: { ...from, progress: captured.fromProgress }, steps: [], capturePath,
        ...(event.won && index === event.captures.length - 1 ? { finalCue: "victory" as const } : {}),
      }];
    });
    return [movement, ...captures];
  });
  const completeMoveAnimation = useCallback((id: string) => onMoveAnimationComplete(id), [onMoveAnimationComplete]);
  const { motion, bursts } = useCoinSequence(motionRuns, completeMoveAnimation);
  const legal = getLegalLudoTokenIndexes(state);
  const activePlayer = room.players[state.turnIndex];
  const canAct = activePlayer?.profileId === userId && state.winnerIndex === null;
  const canMoveNow = canAct && !motionRuns.length && diceRollAnimationId === null && realtimeConnected && !actionBusy;
  const needsRoll = canMoveNow && state.pendingRoll === null;
  const samePlayerMustRollAgain = canAct && state.message === "No legal move. Roll again for the six.";
  const showNoMoveFeedback = state.message.startsWith("No legal move.") && diceRollResult?.noLegalMove === true;
  const gameFeedback = state.message.startsWith("No legal move.") && !showNoMoveFeedback ? "" : state.message;
  const pieces = new Map<string, Array<{ owner: number; token: number; color: LudoColor }>>();
  const isAnimatingToken = (owner: number, token: number) => ludoMoves.some((event) =>
    (event.playerIndex === owner && event.tokenIndex === token) || event.captures.some((captured) => captured.playerIndex === owner && captured.tokenIndex === token));
  state.players.forEach((player, owner) => player.tokens.forEach((progress, token) => {
    if (progress < 0 || isAnimatingToken(owner, token)) return;
    let cell: Cell;
    if (progress <= 50) cell = LUDO_TRACK[getLudoTrackIndex(player, progress)];
    else if (progress < LUDO_FINISHED) cell = LUDO_HOME_LANES[player.color][progress - 51];
    else cell = { row: 7, col: 7 };
    const key = `${cell.row},${cell.col}`;
    pieces.set(key, [...(pieces.get(key) ?? []), { owner, token, color: player.color }]);
  }));

  function renderPieces(row: number, col: number) {
    const tokens = pieces.get(`${row},${col}`) ?? [];
    return <span className={`ludo-token-stack ${tokens.length === 1 ? "is-single" : ""}`}>{tokens.map((piece) => {
      const movable = piece.owner === state.turnIndex && canMoveNow && legal.includes(piece.token);
      return <button className={`ludo-token ludo-token--${TOKEN_CLASS[piece.color]} ${movable ? "is-legal" : ""}`} type="button" key={`${piece.owner}-${piece.token}`} aria-label={`${state.players[piece.owner].name}, token ${piece.token + 1}${movable ? ", move token" : ""}`} disabled={!movable} onClick={() => onAction({ type: "move", tokenIndex: piece.token })}><JesterCoin color={piece.color} /><span className="ludo-token-index">{piece.token + 1}</span></button>;
    })}</span>;
  }

  return <div className="online-ludo-wrap">
    <div className="ludo-player-panels">{room.players.map((player, index) => <div className={`ludo-player-card ludo-player-card--${TOKEN_CLASS[state.players[index].color]} ${state.turnIndex === index && state.winnerIndex === null ? "is-current" : ""}`} key={player.profileId}><JesterCoin color={state.players[index].color} className="ludo-player-avatar" /><span className="ludo-player-copy"><strong>{player.name}</strong><small>{player.profileId === userId ? "You" : player.connected ? "In the room" : "Reconnecting…"}</small></span>{state.turnIndex === index && state.winnerIndex === null && <span className="ludo-turn-indicator"><Sparkles size={13} /> TURN</span>}</div>)}</div>
    <div className="ludo-game-layout online-ludo-layout">
      <section className="game-board-card ludo-board-card" aria-label="Online Ludo board">
        <div className="ludo-board-topline"><span className="eyebrow">CLOCKWISE TRACK · SAFE STARS</span><span className="ludo-safe-legend"><i>✦</i> Safe</span></div>
        {state.winnerIndex !== null && <div className="ludo-winner-ribbon" role="status"><span aria-hidden="true">✦</span><strong>{state.players[state.winnerIndex].name} wins the round!</strong><span aria-hidden="true">✦</span></div>}
        <div className="ludo-board-frame"><div className="ludo-board" role="grid" aria-label="Online Ludo board">
          {(Object.entries(LUDO_YARD_GRID) as [LudoColor, Cell][]).map(([color, cell]) => {
            const playerIndex = state.players.findIndex((player) => player.color === color);
            if (playerIndex < 0) return <div className={`ludo-yard ludo-yard--${TOKEN_CLASS[color]} ludo-yard--unused`} key={color} style={{ gridRow: `${cell.row + 1} / span 6`, gridColumn: `${cell.col + 1} / span 6` }}><strong>Open yard</strong><span className="ludo-yard-color">{color}</span></div>;
            const player = state.players[playerIndex];
            return <div className={`ludo-yard ludo-yard--${TOKEN_CLASS[color]}`} key={color} style={{ gridRow: `${cell.row + 1} / span 6`, gridColumn: `${cell.col + 1} / span 6` }}><strong>{room.players[playerIndex]?.name}</strong><span className="ludo-yard-color">{color}</span><div className="ludo-yard-token-grid">{player.tokens.map((progress, token) => {
              const moving = isAnimatingToken(playerIndex, token);
              const movable = progress < 0 && !moving && playerIndex === state.turnIndex && canMoveNow && legal.includes(token);
              if (progress >= 0 || moving) return <span className="ludo-yard-token-slot" key={token} aria-hidden="true" />;
              return <button className={`ludo-yard-token ludo-yard-token--${TOKEN_CLASS[color]} ${movable ? "is-legal" : ""}`} key={token} type="button" disabled={!movable} aria-label={`${player.name}, token ${token + 1}, in yard${movable ? ", move token" : ""}`} onClick={() => onAction({ type: "move", tokenIndex: token })}><JesterCoin color={color} /><span className="ludo-token-index">{token + 1}</span></button>;
            })}</div></div>;
          })}
          {LUDO_TRACK.map((cell, index) => <div className={`ludo-board-cell ludo-track-cell ${LUDO_SAFE_TRACK_INDEXES.has(index) ? "is-safe" : ""} ${START_CLASS[index] ? `ludo-track-cell--${START_CLASS[index]}` : ""}`} key={index} style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}>{LUDO_SAFE_TRACK_INDEXES.has(index) && <span className="ludo-star">✦</span>}{renderPieces(cell.row, cell.col)}</div>)}
          {(Object.entries(LUDO_HOME_LANES) as [LudoColor, ReadonlyArray<Cell>][]).flatMap(([color, lane]) => lane.map((cell, index) => <div className={`ludo-board-cell ludo-home-cell ludo-home-cell--${TOKEN_CLASS[color]}`} key={`${color}-${index}`} style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}>{renderPieces(cell.row, cell.col)}</div>))}
          <div className="ludo-finish-cell" style={{ gridRow: 8, gridColumn: 8 }} aria-label="Ludo home finish">{renderPieces(7, 7)}<span aria-hidden="true">HOME</span></div>
          <CoinMotionOverlay motion={motion} bursts={bursts} className="ludo-moving-coin" />
        </div></div>
      </section>
      <aside className="game-side-panel ludo-controls"><div className="ludo-control-heading"><span className="eyebrow">{state.winnerIndex === null ? "CURRENT TURN" : "MATCH COMPLETE"}</span><h2>{state.winnerIndex === null ? state.players[state.turnIndex].name : `${state.players[state.winnerIndex].name} wins!`}</h2></div>
        <div className={`ludo-dice-dock ludo-dice-dock--${TOKEN_CLASS[state.players[state.turnIndex].color]}`}><DiceFace value={state.pendingRoll ?? diceRollResult?.value ?? null} rolling={diceRollAnimationId !== null} animationId={diceRollAnimationId ?? diceRollResult?.id ?? "idle"} className="ludo-dice" /><span>{diceRollAnimationId ? "Rolling…" : state.pendingRoll !== null ? `Rolled ${state.pendingRoll} · choose a highlighted token` : diceRollResult ? `Rolled ${diceRollResult.value}${diceRollResult.noLegalMove ? " · no legal move" : ""}` : "Ready when you are"}</span></div>
        {gameFeedback && <p className="game-feedback" aria-live="polite">{gameFeedback}</p>}<GameSoundToggle />
        {needsRoll && <p className="online-turn-nudge" role="status">Your turn — Roll the dice!</p>}
        {state.winnerIndex === null && !canAct && activePlayer && <p className="online-turn-waiting" role="status">{state.pendingRoll !== null ? `Waiting for ${activePlayer.name} to move.` : `Waiting for ${activePlayer.name} to roll.`}</p>}
        {canAct && !realtimeConnected && <p className="online-turn-waiting" role="status">Not connected — tap Retry connection before rolling.</p>}
        <button className={`button ludo-roll-button ${needsRoll ? "is-your-turn" : ""}`} type="button" onClick={() => onAction({ type: "roll" })} disabled={!canMoveNow || state.pendingRoll !== null}>{actionBusy && pendingActionType === "roll" ? <><Dices size={17} className="is-spinning" /> Rolling…</> : <><Dices size={17} /> {rollRetryAvailable ? "Retry Roll" : diceRollResult?.noLegalMove && samePlayerMustRollAgain ? "Roll Again" : "Roll Dice"}</>}</button>
        {canAct && !realtimeConnected && <button type="button" className="button button--soft" onClick={onReconnect}>Retry connection</button>}
        {state.pendingRoll !== null && <p className="online-hint">Tap the exact highlighted token you want to move.</p>}
      </aside>
    </div>
  </div>;
}

function TicTacToeBoard({ room, userId, onAction }: { room: OnlineRoomSnapshot; userId: string; onAction: BoardAction }) {
  const state = room.state as TicTacToeState;
  const xPlayerIndex = state.xPlayerIndex ?? 0;
  const symbolForSeat = (index: number) => index === xPlayerIndex ? "X" : "O";
  const line = state.winnerIndex === null ? null : getTicTacToeWinningLine(state.board);
  const first = line?.[0];
  const last = line?.[2];
  const isOver = state.winnerIndex !== null || state.isDraw;
  const player = room.players[state.turnIndex];
  const canAct = player?.profileId === userId && !isOver;
  const coordinates = first === undefined || last === undefined ? null : { x1: (first % 3) * 100 + 50, y1: Math.floor(first / 3) * 100 + 50, x2: (last % 3) * 100 + 50, y2: Math.floor(last / 3) * 100 + 50 };
  return <div className="tic-experience online-tic-experience">
    <div className="tic-player-panels">{room.players.map((entry, index) => { const mark = symbolForSeat(index); const cssMark = mark.toLowerCase(); return <div className={`tic-player-card tic-player-card--${cssMark} ${state.turnIndex === index && !isOver ? "is-current" : ""}`} key={entry.profileId}><span className={`tic-player-symbol tic-player-symbol--${cssMark}`}>{mark === "X" ? "×" : "○"}</span><span><strong>{entry.name}{entry.profileId === userId ? " · You" : ""}</strong><small>{state.winnerIndex === index ? "Winner" : `Plays ${mark}`}</small></span></div>; })}</div>
    <div className="game-play-layout tic-game-layout"><section className={`game-board-card tic-board-card ${isOver ? "is-complete" : ""}`} aria-label="Online Tic Tac Toe board">
      <div className="tic-status" aria-live="polite"><span className={`tic-mark tic-mark--${symbolForSeat(state.turnIndex).toLowerCase()}`}>{isOver ? <Sparkles size={18} /> : symbolForSeat(state.turnIndex)}</span><div><span className="eyebrow">{isOver ? "MATCH COMPLETE" : canAct ? "YOUR TURN" : "OPPONENT TURN"}</span><h2>{state.winnerIndex !== null ? `${room.players[state.winnerIndex].name} wins!` : state.isDraw ? "It’s a draw." : `${room.players[state.turnIndex]?.name} to play`}</h2></div></div>
      {state.winnerIndex !== null && <div className="tic-winner-ribbon"><Sparkles size={18} /><strong>{room.players[state.winnerIndex].name} takes the round!</strong><Sparkles size={18} /></div>}
      {state.isDraw && <div className="tic-winner-ribbon tic-winner-ribbon--draw"><strong>Even match · good game.</strong></div>}
      <div className="tic-board-stage">{state.winnerIndex !== null && <div className="tic-particle-burst" aria-hidden="true">{PARTICLES.map((particle) => <i key={particle} style={{ "--particle-angle": `${particle * 25}deg`, "--particle-delay": `${particle * 14}ms`, "--particle-color": `hsl(${particle * 25} 100% 75%)` } as CSSProperties}>{particle % 3 === 0 ? "✦" : particle % 3 === 1 ? "✧" : "•"}</i>)}</div>}
        <div className="tic-play-board" role="grid" aria-label="3 by 3 online Tic Tac Toe board">{coordinates && <svg className="tic-winning-line" viewBox="0 0 300 300" aria-hidden="true"><line x1={coordinates.x1} y1={coordinates.y1} x2={coordinates.x2} y2={coordinates.y2} pathLength="1" /></svg>}{state.board.map((mark, cell) => <button className={`tic-play-cell ${mark ? `tic-play-cell--${mark.toLowerCase()}` : ""} ${line?.some((lineCell) => lineCell === cell) ? "is-winning" : ""}`} type="button" role="gridcell" key={cell} disabled={!canAct || mark !== null} aria-label={`Square ${cell + 1}: ${mark ?? "empty"}`} onClick={() => onAction({ type: "move", cell })}>{mark}</button>)}</div>
      </div>
      {!isOver && <p className="online-turn-tip">The server checks every turn and only accepts moves from the active player.</p>}
    </section><aside className="game-side-panel tic-side-panel"><GameSoundToggle /><div className="game-side-heading"><span className="eyebrow">MATCH STATUS</span><h2>{isOver ? "Good game." : "Take turns."}</h2></div><ol className="game-player-list">{room.players.map((entry, index) => { const mark = symbolForSeat(index); const cssMark = mark.toLowerCase(); return <li className={state.turnIndex === index && !isOver ? "is-current" : ""} key={entry.profileId}><span className={`tic-mark tic-mark--${cssMark}`}>{mark === "X" ? "×" : "○"}</span><span>{entry.name}{entry.profileId === userId ? " (you)" : ""}</span><span className="turn-pill">{state.winnerIndex === index ? "Winner" : state.turnIndex === index && !isOver ? "Playing" : ""}</span></li>; })}</ol></aside></div>
  </div>;
}

function SnakesBoard({ room, userId, onAction, moveAnimations, onMoveAnimationComplete, diceRollAnimationId, diceRollResult, realtimeConnected, actionBusy, pendingActionType, rollRetryAvailable, onReconnect }: { room: OnlineRoomSnapshot; userId: string; onAction: BoardAction; moveAnimations: OnlineMoveAnimation[]; onMoveAnimationComplete: CompleteMoveAnimation; diceRollAnimationId: string | null; diceRollResult: OnlineRollCue | null; realtimeConnected: boolean; actionBusy: boolean; pendingActionType: "roll" | "move" | null; rollRetryAvailable: boolean; onReconnect: () => void }) {
  const state = room.state as SnakesAndLaddersState;
  const snakesMoves = moveAnimations.filter((event): event is OnlineSnakesMoveAnimation => event.gameType === "SNAKES_AND_LADDERS" && event.matchId === room.matchId);
  const pointForSquare = (square: number) => {
    if (square === 0) return { left: 5, top: 105, square };
    const cell = getSnakesBoardCell(square);
    return { left: (cell.col + .5) * 10, top: (cell.row + .5) * 10, square };
  };
  const motionRuns: CoinMoveRun[] = snakesMoves.map((event) => ({
    id: event.id, groupId: event.id, playerIndex: event.playerIndex, color: SNAKE_TOKEN_COLORS[event.playerIndex], start: pointForSquare(event.from),
    steps: event.steps.map(pointForSquare),
    ...(event.transport ? { transport: {
      kind: event.transport, destination: pointForSquare(event.to),
      points: event.transportPoints.map((point, index) => ({ left: point.x / 10, top: point.y / 10, square: index === 0 ? event.landed : index === event.transportPoints.length - 1 ? event.to : undefined })),
      durationMs: event.transport === "snake" ? 1080 : 900,
    } } : {}),
    ...(event.won ? { finalCue: "victory" as const } : {}),
  }));
  const completeMoveAnimation = useCallback((id: string) => onMoveAnimationComplete(id), [onMoveAnimationComplete]);
  const { motion, bursts } = useCoinSequence(motionRuns, completeMoveAnimation);
  const lastMove = state.lastMove;
  const current = room.players[state.turnIndex];
  const isOver = state.winnerIndex !== null;
  const canAct = current?.profileId === userId && !isOver;
  const canRoll = canAct && snakesMoves.length === 0 && diceRollAnimationId === null && realtimeConnected && !actionBusy;
  const message = state.winnerIndex !== null ? `${room.players[state.winnerIndex].name} reached 100 and wins!` : !lastMove ? "Ready for your first roll." : lastMove.landed > 100 ? `Rolled ${lastMove.rolled}; exact finish needed, so the token stays on ${lastMove.from}.` : lastMove.transport === "ladder" ? `Climbed from ${lastMove.landed} to ${lastMove.final}.` : lastMove.transport === "snake" ? `Slid from ${lastMove.landed} to ${lastMove.final}.` : `${room.players[lastMove.playerIndex]?.name} moved to ${lastMove.final}.`;
  return <div className="snakes-experience online-snakes-experience"><div className="snakes-space-banner"><div><span>ONLINE MISSION · COSMIC TRAIL</span><strong>Reach the rainbow.</strong></div><span className="snakes-banner-star" aria-hidden="true">✦</span></div>
    <div className="game-play-layout snakes-game-layout"><section className="game-board-card snakes-board-card" aria-label="Online Snakes and Ladders board"><div className="snakes-board-topline"><span className="eyebrow">SQUARES 1–100</span><span className="snakes-board-legend"><span><ArrowUp size={14} /> Ladder</span><span><ArrowDown size={14} /> Snake</span></span></div>
      {isOver && <div className="snakes-winner-ribbon" role="status"><span aria-hidden="true">✦</span><strong>{state.players[state.winnerIndex!].name} reached 100!</strong><span aria-hidden="true">✦</span></div>}
      <div className="snakes-board" role="grid" aria-label="Online numbered Snakes and Ladders board">{Array.from({ length: 100 }, (_, index) => index + 1).map((square) => { const { row, col } = getSnakesBoardCell(square); const ladder = LADDERS[square]; const snake = SNAKES[square]; return <div className={`snakes-square ${((square + Math.floor((square - 1) / 10)) % 2) ? "snakes-square--shade" : ""} ${ladder ? "snakes-square--ladder" : ""} ${snake ? "snakes-square--snake" : ""}`} key={square} role="gridcell" aria-label={`Square ${square}${ladder ? `, ladder to ${ladder}` : snake ? `, snake to ${snake}` : ""}`} style={{ gridRow: row + 1, gridColumn: col + 1 }}><span className="snakes-square-number">{square}</span></div>; })}
        <svg className="snakes-route-art" viewBox="0 0 1000 1000" aria-hidden="true">{Object.entries(LADDERS).map(([startText, end]) => { const start = Number(startText); const parts = getLadderRouteGeometry(start, end); const active = motion?.phase === "transport" && motion.run.transport?.kind === "ladder" && motion.run.steps.at(-1)?.square === start && motion.run.transport.destination.square === end; return <g className={`snakes-route snakes-ladder${active ? " is-active" : ""}`} key={`ladder-${start}`}><title>{`Ladder from ${start} to ${end}`}</title><path className="ladder-rail-shadow" d={parts.left} /><path className="ladder-rail-shadow" d={parts.right} /><path className="ladder-rail" d={parts.left} /><path className="ladder-rail" d={parts.right} />{parts.rungs.map((rung, index) => <path className="ladder-rung" d={rung} key={index} />)}</g>; })}{Object.entries(SNAKES).map(([headText, tail], index) => { const head = Number(headText); const start = getSnakesSquareCenter(head); const end = getSnakesSquareCenter(tail); const path = getSnakeRouteGeometry(head, tail).path; const active = motion?.phase === "transport" && motion.run.transport?.kind === "snake" && motion.run.steps.at(-1)?.square === head && motion.run.transport.destination.square === tail; return <g className={`snakes-route snakes-serpent snakes-serpent--${index}${active ? " is-active" : ""}`} key={`snake-${head}`}><title>{`Snake head on ${head}, tail on ${tail}`}</title><path className="serpent-outline" d={path} /><path className="serpent-body" d={path} /><path className="serpent-belly" d={path} /><circle className="serpent-head" cx={start.x} cy={start.y} r="31" /><circle className="serpent-eye" cx={start.x - 9} cy={start.y - 7} r="8" /><circle className="serpent-eye" cx={start.x + 9} cy={start.y - 7} r="8" /><circle className="serpent-pupil" cx={start.x - 7} cy={start.y - 7} r="3.5" /><circle className="serpent-pupil" cx={start.x + 11} cy={start.y - 7} r="3.5" /><path className="serpent-tongue" d={`M ${start.x} ${start.y + 17} l 0 13 m 0 -2 -7 8 m 7 -8 7 8`} /><path className="serpent-tail" d={`M ${end.x - 10} ${end.y} l 20 -7 -3 14 Z`} /></g>; })}</svg>
        <svg className="snakes-token-layer" viewBox="0 0 1000 1000" aria-hidden="true">{getSnakesTokenPlacements(state.players.map((entry) => entry.position), snakesMoves.map((event) => event.playerIndex)).map((token) => <svg key={token.playerIndex} x={token.x - token.size / 2} y={token.y - token.size / 2} width={token.size} height={token.size} viewBox="0 0 100 100" className={`snakes-static-token${state.turnIndex === token.playerIndex ? " is-current" : ""}`}><title>{`${room.players[token.playerIndex].name} on square ${token.square}`}</title><JesterCoinArtwork color={SNAKE_TOKEN_COLORS[token.playerIndex]} /></svg>)}</svg>
        <CoinMotionOverlay motion={motion} bursts={bursts} className="snakes-moving-token" layerClassName="coin-motion-layer--snakes" />
      </div>
      <div className="snakes-player-positions">{state.players.map((player, index) => <div className={`snakes-position snakes-position--${SNAKE_PLAYER_COLORS[index]} ${state.turnIndex === index && !isOver ? "is-current" : ""}`} key={room.players[index].profileId}><JesterCoin color={SNAKE_TOKEN_COLORS[index]} className="snakes-player-token" /><span><strong>{player.name}</strong><small>{room.players[index].profileId === userId ? "You" : room.players[index].connected ? "In the room" : "Reconnecting…"} · {player.position === 0 ? "At start" : `Square ${player.position}`}</small></span></div>)}</div>
    </section><aside className="game-side-panel snakes-controls"><div className="snakes-turn-banner"><span className="eyebrow">{isOver ? "MISSION COMPLETE" : canAct ? "YOUR TURN" : "CURRENT TURN"}</span><h2>{isOver ? `${state.players[state.winnerIndex!].name} wins!` : current?.name}</h2></div><div className="snakes-dice-dock"><DiceFace value={diceRollResult?.value ?? lastMove?.rolled ?? null} rolling={diceRollAnimationId !== null} animationId={diceRollAnimationId ?? diceRollResult?.id ?? "idle"} className="snakes-dice" /><span>{diceRollAnimationId ? "Rolling…" : diceRollResult ? `Rolled ${diceRollResult.value}` : lastMove ? `Last roll: ${lastMove.rolled}` : "Ready when you are"}</span></div><p className="game-feedback" aria-live="polite">{message}</p>{!isOver && (canRoll || !canAct) && <p className={canRoll ? "online-turn-nudge" : "online-turn-waiting"} role="status">{canRoll ? "Your turn — Roll the dice!" : `Waiting for ${current?.name ?? "the current player"} to roll.`}</p>}{canAct && !realtimeConnected && <p className="online-turn-waiting" role="status">The table connection is unavailable. Reconnect before rolling.</p>}<GameSoundToggle /><button className={`button snakes-roll-button ${canRoll ? "is-your-turn" : ""}`} type="button" onClick={() => onAction({ type: "roll" })} disabled={!canRoll}>{actionBusy && pendingActionType === "roll" ? <><Dices size={17} className="is-spinning" /> Rolling…</> : <><Dices size={17} /> {rollRetryAvailable ? "Retry Roll" : "Roll Dice"}</>}</button>{canAct && !realtimeConnected && <button type="button" className="button button--soft" onClick={onReconnect}>Reconnect</button>}<ol className="game-player-list snakes-turn-list">{room.players.map((player, index) => <li className={state.turnIndex === index && !isOver ? "is-current" : ""} key={room.players[index].profileId}><JesterCoin color={SNAKE_TOKEN_COLORS[index]} className="snakes-player-token" /><span>{player.name}{player.profileId === userId ? " (you)" : ""}</span><span className="turn-pill">{state.players[index].position}</span></li>)}</ol></aside></div>
  </div>;
}

export function OnlineGameBoards({ room, userId, onAction, moveAnimations = [], onMoveAnimationComplete = noopCompleteMoveAnimation, diceRollAnimationId = null, diceRollResult = null, realtimeConnected = true, actionBusy = false, pendingActionType = null, rollRetryAvailable = false, onReconnect = noopReconnect }: { room: OnlineRoomSnapshot; userId: string; onAction: BoardAction; moveAnimations?: OnlineMoveAnimation[]; onMoveAnimationComplete?: CompleteMoveAnimation; diceRollAnimationId?: string | null; diceRollResult?: OnlineRollCue | null; realtimeConnected?: boolean; actionBusy?: boolean; pendingActionType?: "roll" | "move" | null; rollRetryAvailable?: boolean; onReconnect?: () => void }) {
  if (!room.state) return <div className="online-waiting-state"><span className="online-waiting-mark">✦</span><h2>Waiting for players.</h2><p>{room.players.length} of {room.maxPlayers} seats are filled. The match begins when the room is full.</p><div className="online-waiting-players">{room.players.map((player, index) => <span key={player.profileId}><i>{index + 1}</i>{player.name}{player.profileId === userId ? " · You" : ""}</span>)}</div></div>;
  if (room.gameType === "LUDO") return <LudoBoard room={room} userId={userId} onAction={onAction} moveAnimations={moveAnimations} onMoveAnimationComplete={onMoveAnimationComplete} diceRollAnimationId={diceRollAnimationId} diceRollResult={diceRollResult} realtimeConnected={realtimeConnected} actionBusy={actionBusy} pendingActionType={pendingActionType} rollRetryAvailable={rollRetryAvailable} onReconnect={onReconnect} />;
  if (room.gameType === "TIC_TAC_TOE") return <TicTacToeBoard room={room} userId={userId} onAction={onAction} />;
  return <SnakesBoard room={room} userId={userId} onAction={onAction} moveAnimations={moveAnimations} onMoveAnimationComplete={onMoveAnimationComplete} diceRollAnimationId={diceRollAnimationId} diceRollResult={diceRollResult} realtimeConnected={realtimeConnected} actionBusy={actionBusy} pendingActionType={pendingActionType} rollRetryAvailable={rollRetryAvailable} onReconnect={onReconnect} />;
}
