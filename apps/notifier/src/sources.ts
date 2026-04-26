import type { Source } from "@flat-finder/types";

/**
 * Map Source enum values to the human-readable name we display in
 * emails. Keep in sync with @flat-finder/types `Source`.
 */
export const SOURCE_DISPLAY_NAME: Record<Source, string> = {
  sreality: "Sreality",
  bezrealitky: "Bezrealitky",
  ulovdomov: "UlovDomov",
  bazos: "Bazos",
  ereality: "eReality",
  eurobydleni: "EuroBydlení",
  ceskereality: "Česká reality",
  realitymix: "RealityMix",
  idnes: "iDNES",
  realingo: "Realingo",
};

/**
 * Look up a portal's display name. Falls back to capitalizing the
 * source key so a new portal we forgot to add still renders sanely.
 */
export function humanReadableSourceName(source: string | null | undefined): string {
  if (!source) return "";
  const known = SOURCE_DISPLAY_NAME[source as Source];
  if (known) return known;
  return source.charAt(0).toUpperCase() + source.slice(1);
}
