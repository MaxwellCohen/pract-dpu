import { HeadAttributes } from "./types.mjs";

//#region src/font.d.ts
/**
 * First-party helper for self-hosted fonts.
 *
 * `defineFont()` turns a font file in `public/` into a typed object that
 * carries everything the head renderer needs: the `@font-face` CSS, an
 * optional adjusted local fallback face (metric overrides), a preload link
 * descriptor, and a ready-to-use `fontFamily`/`className` for components.
 *
 * The helper is pure data — it never reads or fetches font files, so it is
 * safe in every environment (server, browser, workers) and adds nothing to
 * build time. Fetching Google Fonts or computing fallback metrics from the
 * font binary is intentionally out of scope for now.
 */
type FontDisplay = "auto" | "block" | "swap" | "fallback" | "optional";
interface FontSourceInput {
  /** Public URL of the font file, e.g. `/fonts/inter-latin.woff2`. */
  url: string;
  /** `format()` hint for the `src` descriptor. Defaults to `"woff2"`. */
  format?: string;
}
interface FontSource {
  url: string;
  format: string;
}
interface DefineFontOptions {
  /** Font family name used in `@font-face` and the font stack. */
  family: string;
  /**
   * Public path of the font file (woff2 assumed), or an array of variants
   * (`string` or `{ url, format }`) for the same face. WOFF2 variants are
   * emitted before fallback formats so the preloaded source is selected.
   */
  src: string | ReadonlyArray<string | FontSourceInput>;
  /** `font-weight` descriptor: `400`, `"700"`, `"auto"`, or a variable range `"100 900"`. */
  weight?: number | string;
  /** `font-style` descriptor: `"normal"`, `"italic"`, `"auto"`, or an oblique angle/range. */
  style?: string;
  /** `font-display` descriptor. Defaults to `"swap"`. */
  display?: FontDisplay;
  /** Emit a `<link rel="preload" as="font">` for the font. Defaults to `true`. */
  preload?: boolean;
  /** `unicode-range` descriptor, e.g. `"U+0000-00FF, U+2192"`. */
  unicodeRange?: string;
  /**
   * Fallback families appended to the font stack, e.g.
   * `["Arial", "sans-serif"]`. When metric overrides are provided, the first
   * non-generic entry becomes the `local()` source of the adjusted fallback
   * face.
   */
  fallbacks?: readonly string[];
  /**
   * The locally installed font the metric overrides were computed against,
   * e.g. `"Arial"`. Defaults to the first non-generic entry in `fallbacks`.
   * Set this when the stack starts with names `local()` cannot match, such
   * as `-apple-system`.
   */
  metricsFallback?: string;
  /** `size-adjust` for the fallback face, e.g. `"107%"`. */
  sizeAdjust?: string;
  /** `ascent-override` for the fallback face, e.g. `"90%"`. */
  ascentOverride?: string;
  /** `descent-override` for the fallback face, e.g. `"22%"`. */
  descentOverride?: string;
  /** `line-gap-override` for the fallback face, e.g. `"0%"`. */
  lineGapOverride?: string;
}
interface PrachtFont {
  /** Font family name as passed to `defineFont()`. */
  readonly family: string;
  /** Full font stack, e.g. `"Inter", "Inter Fallback", sans-serif`. */
  readonly fontFamily: string;
  /** Class name whose rule (emitted with the font CSS) applies the stack. */
  readonly className: string;
  /** Inline-style object for JSX: `<h1 style={font.style}>`. */
  readonly style: {
    readonly fontFamily: string;
  };
  /** Resolved source variants (format defaulted to `"woff2"`). */
  readonly sources: readonly FontSource[];
  /** Whether the head renderer should emit preload links for this font. */
  readonly preload: boolean;
  /** @internal Preload link descriptors (deduped by `href` at render time). */
  readonly preloadLinks: readonly HeadAttributes[];
  /** @internal `@font-face` CSS for the web font. Fully escaped. */
  readonly faceCss: string;
  /** @internal Adjusted local fallback `@font-face`, when metrics are set. */
  readonly fallbackFaceCss?: string;
  /** @internal Class rule applying the font stack. Fully escaped. */
  readonly classCss: string;
}
/**
 * Define a self-hosted font. Register the returned object in a shell or route
 * `head()` via the `fonts` array; use `font.className` / `font.style` /
 * `font.fontFamily` in components:
 *
 * ```ts
 * // src/fonts.ts
 * export const inter = defineFont({
 *   family: "Inter",
 *   src: "/fonts/inter-latin.woff2",
 *   weight: "100 900",
 *   fallbacks: ["Arial", "sans-serif"],
 *   sizeAdjust: "107%",
 * });
 *
 * // src/shells/public.tsx
 * export function head() {
 *   return { title: "My Site", fonts: [inter] };
 * }
 * ```
 *
 * The head renderer expands each font into `<link rel="preload" as="font"
 * type="font/woff2" crossorigin>` plus one inline `<style>` with the
 * `@font-face` rules, deduped across shell and route contributions.
 */
declare function defineFont(options: DefineFontOptions): PrachtFont;
interface FontHeadFragments {
  /** Preload link descriptors, deduped by `href`. */
  preloadLinks: HeadAttributes[];
  /** Combined CSS for one inline `<style>` block. Already escaped. */
  css: string;
}
//#endregion
export { DefineFontOptions, FontDisplay, FontHeadFragments, FontSource, FontSourceInput, PrachtFont, defineFont };