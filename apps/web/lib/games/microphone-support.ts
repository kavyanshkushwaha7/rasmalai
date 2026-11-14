/** Explain secure-context and browser API failures without requesting permission. */
export function getMicrophoneAccessUnavailableMessage(
  isSecureContext: boolean,
  hasGetUserMedia: boolean,
) {
  if (!isSecureContext) {
    return "Microphone access requires HTTPS on this device. The Mac's HTTP Wi-Fi address is not secure; open the HTTPS test URL instead. localhost works only on the same device.";
  }
  if (!hasGetUserMedia) {
    return "Microphone access is unavailable in this browser. Use a current browser and check its microphone site permission.";
  }
  return null;
}

/** Convert browser media errors to useful, non-technical voice-chat feedback. */
export function getMicrophoneAccessErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "name" in error) {
    const name = String(error.name);
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Microphone permission is blocked. Allow microphone access for this site, then choose Join voice again.";
    }
    if (name === "NotFoundError") {
      return "No microphone was found on this device.";
    }
    if (name === "NotReadableError" || name === "AbortError") {
      return "The microphone could not be opened. Close other apps using it, then try again.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Microphone access could not start. Check this site's microphone permission and try again.";
}
