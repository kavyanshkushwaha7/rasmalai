"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isArcadeSoundEnabled, setArcadeSoundEnabled, unlockArcadeAudio } from "@/lib/games/arcade-audio";

export function GameSoundToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isArcadeSoundEnabled());
    const sync = (event: StorageEvent) => { if (event.key === "rasmalai:game-sound-enabled") setEnabled(event.newValue === "true"); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setArcadeSoundEnabled(next);
    if (next) unlockArcadeAudio();
  }

  return <button className="game-sound-toggle" type="button" aria-pressed={enabled} aria-label={enabled ? "Turn game sounds off" : "Turn game sounds on"} onClick={toggle}>
    {enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}<span>Sound {enabled ? "On" : "Off"}</span>
  </button>;
}
