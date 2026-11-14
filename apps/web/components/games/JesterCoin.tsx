export type JesterCoinColor = "red" | "blue" | "green" | "yellow";

const colorClass: Record<JesterCoinColor, string> = {
  red: "red",
  blue: "blue",
  green: "green",
  yellow: "yellow",
};

/** Original, compact jester-medallion artwork shared by local and online games. */
export function JesterCoinArtwork({ color }: { color: JesterCoinColor }) {
  return <g className={`jester-coin-art jester-coin-art--${colorClass[color]}`}>
    <circle className="jester-coin-shadow" cx="50" cy="52" r="48" />
    <circle className="jester-coin-rim" cx="50" cy="48" r="47" />
    <circle className="jester-coin-rim-light" cx="50" cy="48" r="42" />
    <circle className="jester-coin-faceplate" cx="50" cy="48" r="37" />
    <path className="jester-coin-cap" d="M20 34 Q22 17 38 23 L50 11 L62 23 Q78 17 80 34 L73 43 Q50 37 27 43 Z" />
    <path className="jester-coin-cap-panel" d="M38 23 50 11 50 38 Q40 34 32 38Z" />
    <path className="jester-coin-cap-panel jester-coin-cap-panel--alt" d="M50 11 62 23 Q71 21 77 29 L68 39 Q60 35 50 38Z" />
    <circle className="jester-coin-bell" cx="22" cy="33" r="5" />
    <circle className="jester-coin-bell" cx="50" cy="10" r="5" />
    <circle className="jester-coin-bell" cx="78" cy="33" r="5" />
    <path className="jester-coin-collar" d="M30 69 Q50 78 70 69 L83 89 Q66 84 57 94 L50 84 43 94 Q34 84 17 89Z" />
    <path className="jester-coin-mask" d="M50 31 Q70 34 71 52 Q72 69 61 77 L50 83 39 77 Q28 69 29 52 Q30 34 50 31Z" />
    <path className="jester-coin-brow" d="M35 49 Q41 43 47 48 M53 48 Q59 43 65 49" />
    <path className="jester-coin-eye" d="M36 53 Q42 48 47 53 Q42 59 36 53Z M53 53 Q58 48 64 53 Q58 59 53 53Z" />
    <circle className="jester-coin-pupil" cx="42" cy="53" r="2" />
    <circle className="jester-coin-pupil" cx="58" cy="53" r="2" />
    <path className="jester-coin-smile" d="M39 64 Q50 70 61 64 Q59 75 50 75 Q41 75 39 64Z" />
    <path className="jester-coin-gloss" d="M20 39 Q25 20 45 17" />
  </g>;
}

export function JesterCoin({ color, className = "" }: { color: JesterCoinColor; className?: string }) {
  return <span className={`jester-coin jester-coin--${color} ${className}`.trim()} aria-hidden="true">
    <svg viewBox="0 0 100 100" focusable="false"><JesterCoinArtwork color={color} /></svg>
  </span>;
}
