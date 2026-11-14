"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { JesterCoin, type JesterCoinColor } from "@/components/games/JesterCoin";
import { playArcadeSound, type ArcadeSound } from "@/lib/games/arcade-audio";

export const COIN_TRAVEL_MS = 300;
export const COIN_LANDING_MS = 110;
export const COIN_TRANSPORT_MS = 900;
export const COIN_CAPTURE_MS = 780;
const SPARKLE_LIFETIME_MS = 360;

export type CoinPoint = { left: number; top: number; square?: number; progress?: number };
export type CoinTransport = {
  destination: CoinPoint;
  kind: "snake" | "ladder";
  points?: CoinPoint[];
  durationMs?: number;
};
export type CoinMoveRun = {
  id: string;
  /** Runs in one authoritative move share a group and complete as a unit. */
  groupId?: string;
  color: JesterCoinColor;
  badge?: string;
  playerIndex?: number;
  tokenIndex?: number;
  kind?: "move" | "capture";
  startCue?: ArcadeSound;
  finalCue?: ArcadeSound;
  start: CoinPoint;
  steps: CoinPoint[];
  /** Capture return path. Points include the origin and the destination yard. */
  capturePath?: CoinPoint[];
  transport?: CoinTransport;
};
export type CoinMotion = {
  run: CoinMoveRun;
  stepIndex: number;
  phase: "travel" | "landing" | "transport" | "capture";
  transportIndex?: number;
  pathIndex?: number;
};
type LandingBurst = { key: string; point: CoinPoint; kind: "landing" | "impact" };

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function transportPoints(run: CoinMoveRun) {
  if (run.transport?.points?.length) return run.transport.points;
  return [run.steps.at(-1) ?? run.start, run.transport?.destination ?? run.start];
}

function currentPoint(motion: CoinMotion): CoinPoint {
  if (motion.phase === "capture") {
    return motion.run.capturePath?.[motion.pathIndex ?? 0] ?? motion.run.start;
  }
  if (motion.phase === "transport" && motion.run.transport) {
    const points = transportPoints(motion.run);
    return points[Math.min(motion.transportIndex ?? 0, points.length - 1)] ?? motion.run.transport.destination;
  }
  return motion.stepIndex < 0 ? motion.run.start : motion.run.steps[motion.stepIndex];
}

function pct(value: number) { return `${Number(value.toFixed(4))}%`; }

export function useCoinSequence(runs: CoinMoveRun[], onComplete: (groupId: string) => void) {
  const initialRun = runs[0];
  const runsRef = useRef(runs);
  const onCompleteRef = useRef(onComplete);
  const runSignature = runs.map((run) => run.id).join("\u001f");
  runsRef.current = runs;
  onCompleteRef.current = onComplete;
  const [motion, setMotion] = useState<CoinMotion | null>(() => initialRun
    ? { run: initialRun, stepIndex: -1, phase: initialRun.kind === "capture" ? "capture" : "travel", pathIndex: 0 }
    : null);
  const [bursts, setBursts] = useState<LandingBurst[]>([]);
  const started = useRef(new Set(initialRun ? [initialRun.id] : []));
  const completed = useRef(new Set<string>());
  const fired = useRef(new Set<string>());
  const burstTimeouts = useRef(new Set<number>());

  useLayoutEffect(() => {
    const currentRuns = runsRef.current;
    if (motion && !currentRuns.some((run) => run.id === motion.run.id)) {
      setMotion(null);
      return;
    }
    if (motion) return;
    const next = currentRuns.find((run) => !started.current.has(run.id));
    if (!next) return;
    started.current.add(next.id);
    setMotion({ run: next, stepIndex: -1, phase: next.kind === "capture" ? "capture" : "travel", pathIndex: 0 });
  }, [motion, runSignature]);

  useEffect(() => {
    if (!motion) return;
    const { run } = motion;
    const groupId = run.groupId ?? run.id;
    const fire = (cueKey: string, sound: ArcadeSound | undefined) => {
      if (!sound || fired.current.has(cueKey)) return;
      fired.current.add(cueKey);
      playArcadeSound(cueKey, sound);
    };
    const burst = (key: string, point: CoinPoint, kind: LandingBurst["kind"]) => {
      setBursts((current) => [...current.filter((entry) => entry.key !== key), { key, point, kind }].slice(-10));
      const timeout = window.setTimeout(() => {
        setBursts((current) => current.filter((entry) => entry.key !== key));
        burstTimeouts.current.delete(timeout);
      }, SPARKLE_LIFETIME_MS);
      burstTimeouts.current.add(timeout);
    };
    const finish = () => {
      if (completed.current.has(run.id)) return;
      completed.current.add(run.id);
      const anotherRunInGroup = runsRef.current.some((entry) => (entry.groupId ?? entry.id) === groupId && entry.id !== run.id && !started.current.has(entry.id));
      if (!anotherRunInGroup) {
        fire(`${groupId}:final:${run.finalCue ?? "none"}`, run.finalCue);
        onCompleteRef.current(groupId);
      }
      setMotion((current) => current?.run.id === run.id ? null : current);
    };

    if (motion.phase === "travel" && motion.stepIndex < 0) {
      fire(`${run.id}:start:${run.startCue ?? "none"}`, run.startCue);
      if (reducedMotion()) {
        if (run.kind === "capture") fire(`${run.id}:start:capture`, "capture");
        if (run.transport) fire(`${run.id}:transport:${run.transport.kind}`, run.transport.kind);
        finish();
        return;
      }
      const frame = window.requestAnimationFrame(() => setMotion((current) => current?.run.id === run.id ? { ...current, stepIndex: 0 } : current));
      return () => window.cancelAnimationFrame(frame);
    }

    if (motion.phase === "capture" && (motion.pathIndex ?? 0) === 0) {
      fire(`${run.id}:start:${run.startCue ?? "capture"}`, run.startCue ?? "capture");
      burst(`${run.id}:impact`, run.start, "impact");
      if (reducedMotion()) { finish(); return; }
      const frame = window.requestAnimationFrame(() => setMotion((current) => current?.run.id === run.id ? { ...current, pathIndex: 1 } : current));
      return () => window.cancelAnimationFrame(frame);
    }

    if (motion.phase === "transport") {
      fire(`${run.id}:transport:${run.transport?.kind}`, run.transport?.kind);
    }

    // The coin has reached the square when the phase changes from travel to
    // landing. Fire the pop and draw the burst at that moment (rather than at
    // the end of the landing dwell), so the effects are visible on every
    // intermediate square before the next hop begins.
    if (motion.phase === "landing") {
      const key = `${run.id}:landing:${motion.stepIndex}`;
      if (!fired.current.has(key)) {
        fired.current.add(key);
        playArcadeSound(key, "pop");
        burst(key, run.steps[motion.stepIndex], "landing");
      }
    }

    if (reducedMotion()) { finish(); return; }
    const routePoints = motion.phase === "transport" ? transportPoints(run) : run.capturePath ?? [];
    const segmentCount = Math.max(1, routePoints.length - 1);
    const duration = motion.phase === "travel" ? COIN_TRAVEL_MS
      : motion.phase === "landing" ? COIN_LANDING_MS
        : motion.phase === "transport" ? (run.transport?.durationMs ?? COIN_TRANSPORT_MS) / segmentCount
          : COIN_CAPTURE_MS / segmentCount;
    const timeout = window.setTimeout(() => {
      if (motion.phase === "travel") {
        setMotion((current) => current?.run.id === run.id ? { ...current, phase: "landing" } : current);
        return;
      }
      if (motion.phase === "landing") {
        if (motion.stepIndex + 1 < run.steps.length) {
          setMotion((current) => current?.run.id === run.id ? { ...current, stepIndex: current.stepIndex + 1, phase: "travel" } : current);
        } else if (run.transport) {
          setMotion((current) => current?.run.id === run.id ? { ...current, phase: "transport", transportIndex: 0 } : current);
        } else finish();
        return;
      }
      if (motion.phase === "transport") {
        const points = transportPoints(run);
        const index = motion.transportIndex ?? 0;
        if (index + 1 < points.length) {
          setMotion((current) => current?.run.id === run.id ? { ...current, transportIndex: index + 1 } : current);
        } else finish();
        return;
      }
      const path = run.capturePath ?? [];
      const index = motion.pathIndex ?? 0;
      if (index + 1 < path.length) setMotion((current) => current?.run.id === run.id ? { ...current, pathIndex: index + 1 } : current);
      else finish();
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [motion]);

  useEffect(() => () => { for (const timeout of burstTimeouts.current) clearTimeout(timeout); }, []);
  return { motion, bursts };
}

export function CoinMotionOverlay({ motion, bursts, className, layerClassName = "" }: { motion: CoinMotion | null; bursts: LandingBurst[]; className: string; layerClassName?: string }) {
  if (!motion && !bursts.length) return null;
  const point = motion ? currentPoint(motion) : null;
  const step = motion?.stepIndex ?? -1;
  const points = motion?.phase === "transport" ? transportPoints(motion.run) : motion?.run.capturePath ?? [];
  const segmentCount = Math.max(1, points.length - 1);
  const duration = motion?.phase === "transport" ? (motion.run.transport?.durationMs ?? COIN_TRANSPORT_MS) / segmentCount
    : motion?.phase === "capture" ? COIN_CAPTURE_MS / segmentCount : COIN_TRAVEL_MS;
  const faceKey = !motion ? "none" : motion.phase === "travel" || motion.phase === "landing"
    ? `${motion.run.id}:${motion.phase}:${step}` : `${motion.run.id}:${motion.phase}`;
  return <div className={`coin-motion-layer ${layerClassName}`} aria-hidden="true">
    {motion && point && <div className={`coin-motion-token ${className} coin-motion-token--${motion.phase} ${motion.run.kind === "capture" ? "coin-motion-token--capture" : ""} ${motion.run.startCue === "unlock" ? "coin-motion-token--unlock" : ""}`} data-motion-event={motion.run.id} data-motion-player={motion.run.playerIndex ?? ""} data-motion-token={motion.run.tokenIndex ?? ""} data-motion-step={Math.max(0, step + 1)} data-motion-count={motion.run.steps.length} data-motion-phase={motion.phase} data-motion-square={point.square ?? ""} data-motion-progress={point.progress ?? ""} data-motion-route-step={motion.phase === "transport" ? motion.transportIndex ?? 0 : motion.phase === "capture" ? motion.pathIndex ?? 0 : ""} data-motion-transport={motion.run.transport?.kind ?? ""} style={{ left: pct(point.left), top: pct(point.top), transitionDuration: `${duration}ms`, "--coin-phase-duration": `${motion.phase === "transport" ? motion.run.transport?.durationMs ?? COIN_TRANSPORT_MS : COIN_CAPTURE_MS}ms` } as CSSProperties}>
      <JesterCoin key={faceKey} color={motion.run.color} className="coin-motion-face" />
      {motion.run.badge && <span className="coin-motion-badge">{motion.run.badge}</span>}
    </div>}
    {bursts.map((burst) => <span className={`coin-landing-burst coin-landing-burst--${burst.kind}`} data-landing-event={burst.key} data-landing-square={burst.point.square ?? ""} data-landing-progress={burst.point.progress ?? ""} style={{ left: pct(burst.point.left), top: pct(burst.point.top) }} key={burst.key}>{Array.from({ length: burst.kind === "impact" ? 10 : 7 }, (_, index) => <i style={{ "--spark-angle": `${index * (360 / (burst.kind === "impact" ? 10 : 7))}deg`, "--spark-delay": `${(index % 3) * 18}ms` } as CSSProperties} key={index}>✦</i>)}</span>)}
  </div>;
}
