/** Resolve the callback's `next` value to a same-origin path only. */
export function getSafeAuthCallbackPath(next: string, requestUrl: string) {
  const request = new URL(requestUrl);
  const target = new URL(next, request);
  if (target.origin !== request.origin) return "/playground";

  const path = `${target.pathname}${target.search}${target.hash}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : "/playground";
}
