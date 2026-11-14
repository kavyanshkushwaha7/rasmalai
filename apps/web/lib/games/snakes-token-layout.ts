import { getSnakesBoardCell, LADDERS, SNAKES } from "@rasmalai/game-engine/snakes-and-ladders";
import { getLadderRouteGeometry, getSnakeRouteGeometry, getSnakesSquareCenter, type SnakesRoutePoint } from "@/lib/games/snakes-route-geometry";

type Move = {
  from: number;
  rolled: number;
  landed: number;
  final: number;
  transport: "snake" | "ladder" | null;
};

export type SnakesTokenPlacement = { playerIndex: number; square: number; x: number; y: number; size: number };
export type SnakesMoveAnimationPlan = { steps: number[]; transportPath: string | null; transportPoints: SnakesRoutePoint[] };
export type SnakesMotionCursor = { phase: "dice" | "transport"; stepIndex: number };

function center(square: number) {
  if (square === 0) return { x: 50, y: 1050 };
  return getSnakesSquareCenter(square);
}

/** Keep every player visible when coins share a square; the mover is rendered on its animated path. */
export function getSnakesTokenPlacements(positions: readonly number[], movingPlayerIndex: number | readonly number[] | null = null): SnakesTokenPlacement[] {
  const movingPlayers = new Set<number>(Array.isArray(movingPlayerIndex) ? movingPlayerIndex : movingPlayerIndex === null ? [] : [movingPlayerIndex as number]);
  const bySquare = new Map<number, number[]>();
  positions.forEach((square, playerIndex) => {
    if (square < 1 || square > 100 || movingPlayers.has(playerIndex)) return;
    bySquare.set(square, [...(bySquare.get(square) ?? []), playerIndex]);
  });

  return [...bySquare].flatMap(([square, players]) => players.map((playerIndex, index) => {
    const count = players.length;
    const size = count === 1 ? 76 : count === 2 ? 60 : count === 3 ? 52 : 48;
    const centers = count === 1
      ? [{ x: 50, y: 50 }]
      : count === 2
        ? [{ x: 34, y: 50 }, { x: 66, y: 50 }]
        : count === 3
          ? [{ x: 34, y: 34 }, { x: 66, y: 34 }, { x: 50, y: 68 }]
          : [{ x: 34, y: 34 }, { x: 66, y: 34 }, { x: 34, y: 66 }, { x: 66, y: 66 }];
    const at = centers[index];
    return { playerIndex, square, x: square === 0 ? at.x : (getSnakesBoardCell(square).col * 100) + at.x, y: square === 0 ? at.y + 1000 : (getSnakesBoardCell(square).row * 100) + at.y, size };
  }));
}

/** One validated board-square destination per die pip, followed by a separate transport. */
export function getSnakesMoveAnimationPlan(move: Move): SnakesMoveAnimationPlan | null {
  if (!Number.isInteger(move.from) || move.from < 0 || move.from > 100 || !Number.isInteger(move.rolled) || move.rolled < 1 || move.rolled > 6) return null;
  if (move.landed !== move.from + move.rolled || move.landed > 100 || move.landed <= move.from) return null;
  const expectedTransport = LADDERS[move.landed] ? "ladder" : SNAKES[move.landed] ? "snake" : null;
  const expectedFinal = LADDERS[move.landed] ?? SNAKES[move.landed] ?? move.landed;
  if (move.transport !== expectedTransport || move.final !== expectedFinal) return null;
  const steps = Array.from({ length: move.rolled }, (_, index) => move.from + index + 1);
  if (steps.at(-1) !== move.landed) return null;
  if (move.transport === "ladder") {
    const route = getLadderRouteGeometry(move.landed, move.final);
    return { steps, transportPath: route.path, transportPoints: route.points };
  }
  if (move.transport === "snake") {
    const route = getSnakeRouteGeometry(move.landed, move.final);
    return { steps, transportPath: route.path, transportPoints: route.points };
  }
  return { steps, transportPath: null, transportPoints: [] };
}

export function getSnakesSquarePath(from: number, to: number): string {
  const start = center(from);
  const end = center(to);
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/** Advance one visible hop, then start a separate snake/ladder transport phase. */
export function advanceSnakesMotion(plan: SnakesMoveAnimationPlan, cursor: SnakesMotionCursor): SnakesMotionCursor | null {
  if (cursor.phase === "transport") return null;
  if (cursor.stepIndex + 1 < plan.steps.length) return { phase: "dice", stepIndex: cursor.stepIndex + 1 };
  return plan.transportPath && plan.steps.length > 0 ? { phase: "transport", stepIndex: plan.steps.length - 1 } : null;
}

/** Full route remains available for route checks and other renderers. */
export function getSnakesMovementPath(move: Move): string | null {
  const plan = getSnakesMoveAnimationPlan(move);
  if (!plan) return null;
  const start = center(move.from);
  const points = [`M ${start.x} ${start.y}`];
  for (const square of plan.steps) {
    const point = center(square);
    points.push(`L ${point.x} ${point.y}`);
  }
  if (plan.transportPath) points.push(plan.transportPath.replace(/^M\s+[-\d.]+\s+[-\d.]+\s+/, ""));
  return points.join(" ");
}
