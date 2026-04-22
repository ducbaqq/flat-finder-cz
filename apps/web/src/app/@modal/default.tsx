/**
 * Parallel-route default for the @modal slot. Returns null so the slot
 * renders nothing when no intercepted route has been matched (e.g. direct
 * navigation to /search, /, /filter, etc.).
 *
 * Required by Next App Router: a parallel slot MUST export a default.tsx
 * or the whole route errors with "Missing default export" on navigation.
 */
export default function ModalDefault() {
  return null;
}
