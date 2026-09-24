/**
 * Prompt discipline for UI screen mockups on qwen-image.
 *
 * A diffusion model garbles dense small text, so the rules that make the
 * difference between a clean product mockup and clip-art soup are:
 *   - describe colors in WORDS, never hex codes printed as text;
 *   - keep REAL text to a few short labels; render all body/rows as bars;
 *   - keep one consistent sidebar across every screen of the same product,
 *     highlighting only the current screen's item.
 * These are encoded here so callers never have to know them.
 */

export type Theme = "dark" | "light";

export interface ScreenInput {
  /** Product name shown as the wordmark (kept short). */
  product: string;
  /** Screen name, e.g. "Overview", "Model Registry". */
  screen: string;
  /** Free description of the main panel: what components, where, proportions. */
  layout: string;
  theme?: Theme;
  /** Palette in plain words, e.g. "near-black graphite with dark charcoal panels". */
  palette?: string;
  /** Single accent color in words, e.g. "electric violet". */
  accent?: string;
  /** Left sidebar nav items, listed once each and shared across screens. */
  sidebar?: string[];
  /** Which sidebar item is highlighted (defaults to `screen`). */
  active?: string;
  /** Short technical tags allowed as real text, e.g. ["RTX 4090", "QLoRA"]. */
  tags?: string[];
  /** Extra style words, e.g. "premium developer tool, fine 1px borders". */
  style?: string;
}

export interface BuiltPrompt {
  positive: string;
  negative: string;
}

const DARK_PALETTE = "near-black graphite background, dark charcoal surfaces, white primary text, muted grey secondary text";
const LIGHT_PALETTE = "soft off-white background, white surfaces, near-black primary text, muted grey secondary text";

const NEGATIVE = [
  "garbled text", "misspelled text", "illegible text", "gibberish", "random letters",
  "lorem ipsum", "dense paragraphs", "walls of text", "many text labels", "tiny unreadable text",
  "duplicated sidebar items", "duplicated ui elements", "watermark", "signature",
  "photograph", "photo of a person", "human face", "human hands", "robot", "3D render",
  "cyberpunk neon", "glossy plastic", "cluttered", "busy", "low resolution", "jpeg artifacts",
].join(", ");

/** Compose the disciplined positive + negative prompt for one screen. */
export function buildScreenPrompt(input: ScreenInput): BuiltPrompt {
  const theme: Theme = input.theme ?? "dark";
  const palette = input.palette ?? (theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE);
  const accent = input.accent ?? (theme === "dark" ? "electric violet" : "electric blue");
  const active = input.active ?? input.screen;
  const style = input.style ?? "premium developer tool, fine 1px borders, subtle glow, generous spacing";

  const frame =
    `flat high-fidelity ${theme} SaaS dashboard UI screenshot, desktop app, ${style}, ` +
    `crisp sharp legible typography, pixel-perfect, 4k`;

  const parts: string[] = [frame + "."];

  parts.push(
    `Colors: ${palette}, with a single ${accent} accent used sparingly, ` +
    `plus small green and amber status dots. Describe colors only as materials, never as printed codes.`
  );

  if (input.sidebar && input.sidebar.length) {
    const items = input.sidebar.join(", ");
    parts.push(
      `Left sidebar: the wordmark "${input.product}" at the top, then these nav items listed exactly once, ` +
      `single word each, no duplicates: ${items}. The item "${active}" is highlighted in the ${accent} accent; ` +
      `all other items are plain.`
    );
  } else {
    parts.push(`Left sidebar with the wordmark "${input.product}" at the top and a short list of single-word nav items.`);
  }

  parts.push(`A slim top bar with a small round avatar on the right, and the screen title "${input.screen}" in the main panel.`);

  parts.push(`Main panel: ${input.layout}`);

  if (input.tags && input.tags.length) {
    parts.push(`Short technical tags shown as small pills (real text is fine here, they are short): ${input.tags.join(", ")}.`);
  }

  parts.push(
    `Text discipline: the ONLY real readable text is the wordmark, the sidebar nav items (once each), ` +
    `the screen title, section and card titles, metric labels with their numbers, and the short tags above. ` +
    `Every table row, list row and body description is a thin horizontal placeholder line or bar with NO words. ` +
    `Charts are clean line, area, donut or bar shapes. Statuses are small colored dots.`
  );

  return { positive: parts.join(" "), negative: NEGATIVE };
}
