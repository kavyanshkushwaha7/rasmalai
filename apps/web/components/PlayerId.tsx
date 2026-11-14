"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function PlayerId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return <button className="player-id" type="button" onClick={copyId} title="Copy your unique player ID">
    <span>PLAYER ID</span><code>{id}</code>{copied ? <Check size={13} /> : <Copy size={13} />}
    <span className="player-id-feedback" aria-live="polite">{copied ? "Copied" : "Copy"}</span>
  </button>;
}
