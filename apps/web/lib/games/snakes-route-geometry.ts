import { getSnakesBoardCell, SNAKES } from "@rasmalai/game-engine/snakes-and-ladders";

export type SnakesRoutePoint = { x: number; y: number };
export type SnakeRouteGeometry = { path: string; points: SnakesRoutePoint[] };
export type LadderRouteGeometry = {
  left: string;
  right: string;
  rungs: string[];
  path: string;
  points: SnakesRoutePoint[];
};

export function getSnakesSquareCenter(square: number): SnakesRoutePoint {
  const { row, col } = getSnakesBoardCell(square);
  return { x: col * 100 + 50, y: row * 100 + 50 };
}

function snakeBend(head: number) {
  const index = Object.keys(SNAKES).findIndex((square) => Number(square) === head);
  return 74 + (Math.max(0, index) % 3) * 14;
}

function cubicPoint(a: SnakesRoutePoint, c1: SnakesRoutePoint, c2: SnakesRoutePoint, b: SnakesRoutePoint, t: number): SnakesRoutePoint {
  const one = 1 - t;
  return {
    x: one ** 3 * a.x + 3 * one ** 2 * t * c1.x + 3 * one * t ** 2 * c2.x + t ** 3 * b.x,
    y: one ** 3 * a.y + 3 * one ** 2 * t * c1.y + 3 * one * t ** 2 * c2.y + t ** 3 * b.y,
  };
}

/** The displayed serpent and its coin route share this exact cubic path. */
export function getSnakeRouteGeometry(head: number, tail: number, sampleCount = 24): SnakeRouteGeometry {
  const a = getSnakesSquareCenter(head);
  const b = getSnakesSquareCenter(tail);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / length;
  const py = dx / length;
  const side = ((head + tail) % 2) ? 1 : -1;
  const bend = snakeBend(head);
  const c1 = { x: a.x + dx * .28 + px * bend * side, y: a.y + dy * .28 + py * bend * side };
  const c2 = { x: a.x + dx * .72 - px * bend * side, y: a.y + dy * .72 - py * bend * side };
  const path = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  const count = Math.max(2, Math.floor(sampleCount));
  const points = Array.from({ length: count + 1 }, (_, index) => cubicPoint(a, c1, c2, b, index / count));
  return { path, points };
}

/** The drawn rails/rungs and the climbing coin use this shared center line. */
export function getLadderRouteGeometry(foot: number, top: number, rungCount = 8): LadderRouteGeometry {
  const a = getSnakesSquareCenter(foot);
  const b = getSnakesSquareCenter(top);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const px = (-dy / length) * 20;
  const py = (dx / length) * 20;
  const left = `M ${a.x + px} ${a.y + py} L ${b.x + px} ${b.y + py}`;
  const right = `M ${a.x - px} ${a.y - py} L ${b.x - px} ${b.y - py}`;
  const rungs = Array.from({ length: rungCount }, (_, index) => {
    const t = (index + 1) / (rungCount + 1);
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    return `M ${x + px} ${y + py} L ${x - px} ${y - py}`;
  });
  const path = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const points = Array.from({ length: rungCount + 2 }, (_, index) => {
    const t = index / (rungCount + 1);
    return { x: a.x + dx * t, y: a.y + dy * t };
  });
  return { left, right, rungs, path, points };
}
