/** Strict parser shared by the web and realtime server processes. Flags default off. */
export function isFeatureFlagEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export const SPECTATOR_MODE_DISABLED_MESSAGE = "Spectator Mode is coming soon.";
