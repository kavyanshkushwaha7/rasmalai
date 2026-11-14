import "server-only";

export type SocialActionFailure =
  | "rate-limited"
  | "access-denied"
  | "invalid-action"
  | "temporarily-unavailable";

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function errorLayers(error: unknown) {
  const layers: ErrorRecord[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  const seen = new Set<object>();
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (!isRecord(item.value) || item.depth > 6 || seen.has(item.value)) continue;
    seen.add(item.value);
    layers.push(item.value);
    for (const key of ["meta", "cause", "driverAdapterError", "originalError", "originalCause", "error"]) {
      const nested = item.value[key];
      if (isRecord(nested)) queue.push({ value: nested, depth: item.depth + 1 });
    }
  }
  return layers;
}

function postgresCode(layers: ErrorRecord[]) {
  for (const layer of layers) {
    for (const key of ["sqlState", "sqlstate", "originalCode"]) {
      const candidate = asString(layer[key]);
      if (candidate && /^[0-9A-Z]{5}$/.test(candidate)) return candidate;
    }
  }
  for (let index = 1; index < layers.length; index += 1) {
    const nestedCode = asString(layers[index].code);
    if (nestedCode === "P0001") return nestedCode;
    if (nestedCode && /^[0-9A-Z]{5}$/.test(nestedCode) && !/^P\d{4}$/.test(nestedCode)) return nestedCode;
  }
  return undefined;
}

function prismaCode(layers: ErrorRecord[]) {
  return layers.map((layer) => asString(layer.code)).find((code) => code && /^P\d{4}$/.test(code));
}

function errorText(layers: ErrorRecord[]) {
  return layers
    .flatMap((layer) => [asString(layer.message), asString(layer.detail)])
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function safeProviderCodePaths(layers: ErrorRecord[]) {
  const paths: string[] = [];
  for (const [index, layer] of layers.entries()) {
    for (const key of ["code", "originalCode", "sqlState", "sqlstate"]) {
      const value = asString(layer[key]);
      if (value && (/^[0-9A-Z]{5}$/.test(value) || /^P\d{4}$/.test(value))) {
        paths.push(`${index}.${key}=${value}`);
      }
    }
  }
  return paths.slice(0, 8);
}

function safeDatabaseReason(layers: ErrorRecord[]) {
  const text = errorText(layers);
  if (/permission denied for function\s+([a-z0-9_.]+)/i.test(text)) {
    return `function_execute_denied:${text.match(/permission denied for function\s+([a-z0-9_.]+)/i)?.[1]?.toLowerCase()}`;
  }
  if (/permission denied for table\s+([a-z0-9_.]+)/i.test(text)) {
    return `table_privilege_denied:${text.match(/permission denied for table\s+([a-z0-9_.]+)/i)?.[1]?.toLowerCase()}`;
  }
  if (/an authenticated user is required/i.test(text)) return "verified_subject_missing_in_database_context";
  if (/conversation not found/i.test(text)) return "conversation_not_found_or_not_member";
  if (/this conversation is unavailable/i.test(text)) return "conversation_membership_invalid";
  if (/this player is unavailable/i.test(text)) return "player_pair_blocked";
  if (/no longer have permission to message this player/i.test(text)) return "message_relationship_not_authorized";
  if (/row-level security/i.test(text)) return "row_level_security_denied";
  return "unclassified_database_failure";
}

/** Classify server errors for user feedback without ever returning raw DB text. */
export function classifySocialActionFailure(error: unknown): SocialActionFailure {
  const layers = errorLayers(error);
  const sqlState = postgresCode(layers);
  const text = errorText(layers);

  if (/too many requests|temporarily limited|rate limit/i.test(text)) return "rate-limited";
  if (sqlState === "42501") return "access-denied";
  if (["22023", "23505", "23503", "P0001"].includes(sqlState ?? "")) return "invalid-action";
  return "temporarily-unavailable";
}

/** Log only a fixed operation label and non-sensitive provider error codes. */
export function logSocialActionFailure(
  action: string,
  stage: "rate-limit" | "mutation",
  error: unknown,
) {
  const layers = errorLayers(error);
  const sqlState = postgresCode(layers);
  const prisma = prismaCode(layers);
  const failure = classifySocialActionFailure(error);
  console.error("[rasmalai-social-action-error]", JSON.stringify({
    action,
    stage,
    failure,
    databaseReason: safeDatabaseReason(layers),
    ...(sqlState ? { sqlState } : {}),
    ...(prisma ? { prismaCode: prisma } : {}),
    providerCodes: safeProviderCodePaths(layers),
  }));
}
