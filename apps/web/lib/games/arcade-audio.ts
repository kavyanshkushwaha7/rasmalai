const SOUND_KEY = "rasmalai:game-sound-enabled";
let audioContext: AudioContext | null = null;
let eventScopeSequence = 0;

export type ArcadeSound = "dice" | "pop" | "unlock" | "capture" | "snake" | "ladder" | "place" | "victory" | "draw";

export function createCueDeduper() {
  const seen = new Set<string>();
  return (id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 600) seen.delete(seen.values().next().value as string);
    return true;
  };
}

/** Give local rounds a per-instance ID so route remounts cannot reuse old cue keys. */
export function createArcadeEventScope(namespace: string) {
  const randomId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${++eventScopeSequence}`;
  return `${namespace}:${randomId}`;
}

const acceptCue = createCueDeduper();

export function isArcadeSoundEnabled() {
  try { return typeof window !== "undefined" && window.localStorage.getItem(SOUND_KEY) === "true"; }
  catch { return false; }
}

export function setArcadeSoundEnabled(enabled: boolean) {
  try { window.localStorage.setItem(SOUND_KEY, String(enabled)); } catch { /* private browsing can deny storage */ }
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext = new AudioContextConstructor();
  return audioContext;
}

/** Called from a user gesture. It starts no sound by itself. */
export function unlockArcadeAudio() {
  if (!isArcadeSoundEnabled()) return;
  const context = getAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

function playSoftPop(context: AudioContext) {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(510, now);
  oscillator.frequency.exponentialRampToValueAtTime(260, now + 0.105);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.105, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.125);
}

function playDiceRattle(context: AudioContext) {
  const now = context.currentTime;
  const duration = 0.28;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1450, now);
  source.buffer = buffer;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.052, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(now);
  source.stop(now + duration);

  [720, 530, 810, 610].forEach((frequency, index) => {
    const start = now + index * 0.055;
    const tick = context.createOscillator();
    const tickGain = context.createGain();
    tick.type = "triangle";
    tick.frequency.setValueAtTime(frequency, start);
    tickGain.gain.setValueAtTime(0.0001, start);
    tickGain.gain.linearRampToValueAtTime(0.025, start + 0.006);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.042);
    tick.connect(tickGain).connect(context.destination);
    tick.start(start);
    tick.stop(start + 0.045);
  });
}

function playTone(context: AudioContext, frequency: number, endFrequency: number, start: number, duration: number, volume: number, type: OscillatorType = "sine") {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration * .82);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + Math.min(.018, duration * .22));
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + .005);
}

function playNoise(context: AudioContext, start: number, duration: number, volume: number, filterType: BiquadFilterType, fromFrequency: number, toFrequency: number) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    const fade = 1 - index / channel.length;
    channel[index] = (Math.random() * 2 - 1) * fade;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(fromFrequency, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(1, toFrequency), start + duration * .85);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + Math.min(.03, duration * .2));
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
  source.stop(start + duration + .005);
}

function playArcadeCue(context: AudioContext, sound: Exclude<ArcadeSound, "pop" | "dice">) {
  const now = context.currentTime;
  if (sound === "place") {
    playTone(context, 820, 560, now, .075, .028, "triangle");
    return;
  }
  if (sound === "unlock") {
    [659.25, 830.61, 1046.5].forEach((note, index) => playTone(context, note, note * 1.12, now + index * .075, .23, .038, "sine"));
    return;
  }
  if (sound === "capture") {
    playNoise(context, now, .16, .055, "lowpass", 950, 210);
    playTone(context, 330, 165, now + .045, .27, .045, "triangle");
    return;
  }
  if (sound === "snake") {
    playNoise(context, now, .42, .035, "highpass", 4200, 1350);
    playTone(context, 440, 174.61, now + .13, .52, .032, "sawtooth");
    return;
  }
  if (sound === "ladder") {
    [493.88, 659.25, 783.99, 987.77].forEach((note, index) => playTone(context, note, note * 1.04, now + index * .085, .22, .032, "triangle"));
    return;
  }
  if (sound === "victory") {
    // One shared, recognizable four-note fanfare for every confirmed win.
    [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => playTone(context, note, note * 1.015, now + index * .105, .34, .042, "triangle"));
    return;
  }
  // A gentle neutral two-note close for a full-board draw.
  playTone(context, 392, 349.23, now, .25, .027, "sine");
  playTone(context, 329.63, 293.66, now + .15, .28, .025, "sine");
}

/** Plays each logical cue at most once per tab, even under Strict Mode or duplicate snapshots. */
export function playArcadeSound(id: string, sound: ArcadeSound) {
  if (!id || !isArcadeSoundEnabled() || !acceptCue(id)) return false;
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  try {
    if (sound === "pop") playSoftPop(context);
    else if (sound === "dice") playDiceRattle(context);
    else playArcadeCue(context, sound);
    return true;
  } catch { return false; }
}
