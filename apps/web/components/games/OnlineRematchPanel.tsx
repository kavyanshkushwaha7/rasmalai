"use client";

import { Check, CheckCircle2, Clock3, RotateCcw } from "lucide-react";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { getOnlineRematchPanelState } from "@/lib/online-rematch";

type RematchPanelProps = {
  room: OnlineRoomSnapshot;
  userId: string;
  busy: boolean;
  connected: boolean;
  onRequest: () => void;
  onRespond: (requestId: string, accept: boolean) => void;
};

export function OnlineRematchPanel({ room, userId, busy, connected, onRequest, onRespond }: RematchPanelProps) {
  const panelState = getOnlineRematchPanelState(room, userId);
  if (!panelState) return null;

  return <section className="online-rematch-panel" aria-labelledby="online-rematch-title" data-testid="online-rematch-panel">
    <div className="online-rematch-copy"><span className="online-rematch-icon"><RotateCcw size={18} /></span><div><span className="eyebrow">SAME TABLE · SAME PLAYERS</span><h2 id="online-rematch-title">One more round?</h2><p>{room.gameType === "TIC_TAC_TOE" ? "Starter and X rotate fairly each round." : "The next round starts only after every player agrees."}</p></div></div>
    {panelState.type === "request" ? <div className="online-rematch-actions"><button type="button" className="button button--mint online-rematch-primary" onClick={onRequest} disabled={busy || !connected}><RotateCcw size={16} />{busy ? "Sending…" : "Play Again"}</button>{panelState.wasDeclined && <span className="online-rematch-note">The last request was declined. You can start a fresh vote.</span>}</div> : <div className="online-rematch-vote">
      <div className="online-rematch-status"><span className="online-rematch-progress"><CheckCircle2 size={15} />{panelState.rematch.acceptedPlayerIds.length} of {panelState.rematch.requiredPlayers} agreed</span><span className="online-rematch-note">{room.players.find((player) => player.profileId === panelState.rematch.requesterId)?.name ?? "A player"} wants another round.</span></div>
      {panelState.type === "waiting" ? <p className="online-rematch-waiting"><Clock3 size={15} />Waiting for the remaining players{room.players.some((player) => !player.connected && !panelState.rematch.acceptedPlayerIds.includes(player.profileId)) ? " to reconnect and respond" : " to agree"}.</p> : <div className="online-rematch-actions"><button type="button" className="button button--mint online-rematch-primary" onClick={() => onRespond(panelState.rematch.requestId, true)} disabled={busy || !connected}><CheckCircle2 size={16} />Accept Rematch</button><button type="button" className="button button--soft online-rematch-decline" onClick={() => onRespond(panelState.rematch.requestId, false)} disabled={busy || !connected}>Decline</button></div>}
      <div className="online-rematch-roster" aria-label="Rematch votes">{room.players.map((player) => { const accepted = panelState.rematch.acceptedPlayerIds.includes(player.profileId); return <span className={accepted ? "is-accepted" : ""} key={player.profileId}><i>{accepted ? <Check size={11} /> : <Clock3 size={11} />}</i>{player.name}{player.profileId === userId ? " · You" : ""}{!player.connected ? " · offline" : ""}</span>; })}</div>
    </div>}
  </section>;
}
