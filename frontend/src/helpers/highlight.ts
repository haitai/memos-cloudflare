/**
 * Syntax highlighting, loaded on demand.
 *
 * `highlight.js` bundles roughly 190 language grammars - about 309kB gzipped,
 * which was nearly half of the app's initial download. No visitor should pay
 * for Python, Erlang and Fortran before their first memo renders.
 *
 * This module is only ever reached through `getHighlighter()`, which defers the
 * import so the chunk is fetched right after first paint instead of blocking it.
 */
import type { HLJSApi } from "highlight.js";

let cached: Promise<HLJSApi> | undefined;

export function getHighlighter(): Promise<HLJSApi> {
  // Cache the promise (not the result) so concurrent callers share one fetch.
  cached ??= import("highlight.js").then((mod) => mod.default);
  return cached;
}

/** Escape HTML entities so raw source can be safely injected with dangerouslySetInnerHTML. */
export function escapeHtml(raw: string): string {
  return Object.assign(document.createElement("span"), { textContent: raw }).innerHTML;
}
