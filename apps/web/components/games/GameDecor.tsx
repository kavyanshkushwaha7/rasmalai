type GameDecorProps = { theme: "ludo" | "snakes" | "tic" };

export function GameDecor({ theme }: GameDecorProps) {
  if (theme === "ludo") {
    return <svg className="game-decor game-decor--jungle" viewBox="0 0 900 180" aria-hidden="true">
      <path d="M0 44C90 5 125 22 156 91 84 85 38 73 0 44Zm900 8c-88-39-125-20-154 48 72-7 119-20 154-48ZM68 151c55-62 95-60 129-1-55 22-92 24-129 1Zm766 0c-55-62-95-60-129-1 55 22 92 24 129 1Z" fill="currentColor" />
      <path d="M48 14c25 18 44 43 63 77M851 18c-27 18-46 43-64 76M141 133c16-18 31-27 50-33m566 33c-16-18-31-27-50-33" fill="none" stroke="rgba(210,255,208,.56)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="450" cy="36" r="4" fill="#f9dc79" /><circle cx="412" cy="67" r="2.5" fill="#fff5ba" /><circle cx="490" cy="83" r="3" fill="#fff5ba" />
    </svg>;
  }

  return <svg className={`game-decor game-decor--space game-decor--${theme}`} viewBox="0 0 1000 250" aria-hidden="true">
    <g className="space-stars" fill="#fff4a4">
      <path d="M106 44l5 13 13 5-13 5-5 13-5-13-13-5 13-5Zm770 18 4 10 10 4-10 4-4 10-4-10-10-4 10-4Zm-98 103 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" />
      <circle cx="254" cy="82" r="3" /><circle cx="724" cy="48" r="2.5" /><circle cx="640" cy="190" r="2" /><circle cx="342" cy="43" r="2" />
    </g>
    <g className="space-rainbow" fill="none" strokeLinecap="round">
      <path d="M360 224a140 140 0 0 1 280 0" stroke="#ff6f79" strokeWidth="18" />
      <path d="M381 224a119 119 0 0 1 238 0" stroke="#ffbd53" strokeWidth="17" />
      <path d="M403 224a97 97 0 0 1 194 0" stroke="#f9e85f" strokeWidth="16" />
      <path d="M425 224a75 75 0 0 1 150 0" stroke="#60d59c" strokeWidth="15" />
      <path d="M447 224a53 53 0 0 1 106 0" stroke="#69c6fa" strokeWidth="14" />
    </g>
    <g className="space-cloud" fill="#eaf8ff">
      <path d="M68 198c0-15 12-27 27-27 6-24 40-28 52-6 20-8 39 7 39 27 15 1 22 20 10 30H85c-10-4-17-13-17-24Z" />
      <path d="M768 190c0-14 11-25 25-25 7-22 38-25 50-5 18-7 36 6 36 24 14 1 21 18 10 28H784c-10-4-16-12-16-22Z" />
    </g>
    <g className="space-rocket" transform="translate(202 66) rotate(-28)">
      <path d="M0 24 42 0c15 23 15 48 0 70L0 46Z" fill="#f7faff" stroke="#8fc5ec" strokeWidth="4" />
      <circle cx="30" cy="35" r="10" fill="#4dbde7" stroke="#fff" strokeWidth="4" />
      <path d="M2 25-13 16v24l15-4m0 10-13 9v17L4 45Z" fill="#fc6681" />
      <path d="M0 34c-17 3-22 14-28 18 13 2 23-1 32-8Z" fill="#ffb347" />
    </g>
    <g className="space-planet" transform="translate(809 74) rotate(-18)">
      <ellipse cx="0" cy="12" rx="52" ry="15" fill="none" stroke="#f2cc6e" strokeWidth="7" />
      <circle r="27" fill="#e893a1" /><path d="M-22-3c14-9 33-7 43 4-4 14-15 23-29 25-10-7-16-17-14-29Z" fill="#ffb4a2" opacity=".8" />
    </g>
    <g className="space-astronaut" transform="translate(500 83)">
      <path d="M-28 57c-27 4-34 19-33 33l23 8 16-24m49-17c27 4 34 19 33 33l-23 8-16-24" fill="#f7fbff" stroke="#b8d7ed" strokeWidth="5" strokeLinejoin="round" />
      <path d="M-37 88c22-17 52-17 74 0l8 48h-90Z" fill="#fbfdff" stroke="#b8d7ed" strokeWidth="5" />
      <rect x="-17" y="107" width="34" height="20" rx="6" fill="#59bddb" /><circle cx="-7" cy="117" r="3" fill="#ffe27b" /><circle cx="7" cy="117" r="3" fill="#ff7790" />
      <circle cy="32" r="41" fill="#f8fcff" stroke="#bdd9ec" strokeWidth="5" />
      <ellipse cy="32" rx="29" ry="24" fill="#17365f" stroke="#85d8f0" strokeWidth="5" />
      <path d="M-18 29q8-9 16 0m4 0q8-9 16 0" fill="none" stroke="#ffe78a" strokeWidth="4" strokeLinecap="round" />
      <path d="M-22 54h44" stroke="#a8cbe1" strokeWidth="4" strokeLinecap="round" />
    </g>
  </svg>;
}
