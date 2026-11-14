"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, UsersRound } from "lucide-react";

export function PlayerSetup({ title, description, minPlayers, maxPlayers, initialCount = minPlayers, onStart }: {
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  initialCount?: number;
  onStart: (names: string[]) => void;
}) {
  const [count, setCount] = useState(initialCount);
  const [names, setNames] = useState(() => Array.from({ length: initialCount }, () => ""));

  function changeCount(nextCount: number) {
    setCount(nextCount);
    setNames((current) => Array.from({ length: nextCount }, (_, index) => current[index] ?? ""));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onStart(names.slice(0, count).map((name, index) => name.trim().slice(0, 18) || `Player ${index + 1}`));
  }

  return (
    <form className="game-setup-card" onSubmit={submit}>
      <span className="setup-icon"><UsersRound size={21} /></span>
      <div><span className="eyebrow">PASS THE DEVICE</span><h2>{title}</h2><p>{description}</p></div>
      {maxPlayers > minPlayers && <label className="game-player-count">Players
        <select value={count} onChange={(event) => changeCount(Number(event.target.value))}>
          {Array.from({ length: maxPlayers - minPlayers + 1 }, (_, index) => minPlayers + index).map((players) => <option key={players} value={players}>{players} players</option>)}
        </select>
      </label>}
      <div className="game-name-fields">{names.slice(0, count).map((name, index) => (
        <label className="game-name-field" key={index}><span>Player {index + 1}</span>
          <input maxLength={18} value={name} placeholder={`Player ${index + 1}`} onChange={(event) => setNames((current) => current.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))} />
        </label>
      ))}</div>
      <button className="button button--primary game-start-button" type="submit">Start game <ArrowRight size={16} /></button>
    </form>
  );
}
