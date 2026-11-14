import type { ReactNode } from "react";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function DiceFace({ value, className = "", rolling = false, animationId = "idle" }: { value: number | null; className?: string; rolling?: boolean; animationId?: string }) {
  const validValue = Number.isInteger(value) && value !== null && value >= 1 && value <= 6 ? value : null;
  const showResult = validValue !== null && !rolling;
  const label = rolling ? "Die rolling; result pending" : showResult ? `Die shows ${validValue}` : "Die ready to roll";

  return <DiceFaceFrame key={animationId} className={className} label={label} state={rolling ? "rolling" : showResult ? "result" : "idle"}>
    {showResult
      ? <>{Array.from({ length: 9 }, (_, pip) => <i className={`dice-pip${validValue !== null && PIPS[validValue].includes(pip) ? " is-visible" : ""}`} data-pip-index={pip} key={pip} />)}<b className="dice-face-number" aria-hidden="true">{validValue}</b></>
      : <svg className="game-dice-idle-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M24 4.5 42 14.7v18.6L24 43.5 6 33.3V14.7L24 4.5Z" /><path d="M24 23.8v19.1m0-19.1 18-9.1m-18 9.1L6 14.7" /></svg>}
  </DiceFaceFrame>;
}

function DiceFaceFrame({ children, className, label, state }: { children: ReactNode; className: string; label: string; state: "idle" | "rolling" | "result" }) {
  return <span className={`game-dice-face game-dice-face--${state} ${className}`} role="img" aria-label={label} data-dice-state={state}>
    {children}
  </span>;
}
