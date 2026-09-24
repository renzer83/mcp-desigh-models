/**
 * Prompt discipline for the two things this server renders:
 *   1. UI screen SKELETONS (buildScreenPrompt) — layout composition with
 *      placeholder text, so a diffusion model never has to spell real copy.
 *   2. Content ASSETS (buildAssetPrompt) — the real imagery a site uses
 *      (hero, illustration, icon, background, logo), where photos are allowed.
 *
 * Screen rule of thumb (placeholder mode B): the only real words are the
 * wordmark, the sidebar nav items, the screen title and section/card titles.
 * Everything else — body copy, table/list rows, long descriptions — is drawn
 * as greeked placeholder lines and bars. The real copy lives in the spec.
 */

export type Theme = "dark" | "light";
export type AssetType = "photo" | "illustration" | "icon" | "background" | "logo";

export interface ScreenInput {
  product: string;
  screen: string;
  layout: string;
  theme?: Theme;
  palette?: string;
  accent?: string;
  sidebar?: string[];
  active?: string;
  tags?: string[];
  style?: string;
}

export interface AssetInput {
  product: string;
  /** What this asset is for, e.g. "landing hero", "empty state". */
  role: string;
  type: AssetType;
  /** Scene / subject description. */
  prompt: string;
  palette?: string;
  accent?: string;
  style?: string;
}

export interface BuiltPrompt {
  positive: string;
  negative: string;
}

const DARK_PALETTE = "near-black graphite background, dark charcoal surfaces, white primary text, muted grey secondary text";
const LIGHT_PALETTE = "soft off-white background, white surfaces, near-black primary text, muted grey secondary text";

const SCREEN_NEGATIVE = [
  "garbled text", "misspelled text", "illegible text", "gibberish", "random letters",
  "lorem ipsum words", "dense paragraphs", "walls of text", "many text labels", "tiny unreadable text",
  "duplicated sidebar items", "duplicated ui elements", "watermark", "signature",
  "photograph", "photo of a person", "human face", "human hands", "robot", "3D render",
  "cyberpunk neon", "glossy plastic", "cluttered", "busy", "low resolution", "jpeg artifacts",
].join(", ");

/** Disciplined prompt for one UI screen skeleton (placeholder mode B). */
export function buildScreenPrompt(input: ScreenInput): BuiltPrompt {
  const theme: Theme = input.theme ?? "dark";
  const palette = input.palette ?? (theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE);
  const accent = input.accent ?? (theme === "dark" ? "electric violet" : "electric blue");
  const active = input.active ?? input.screen;
  const style = input.style ?? "premium developer tool, fine 1px borders, subtle glow, generous spacing";

  const parts: string[] = [
    `flat high-fidelity ${theme} SaaS dashboard UI screenshot, desktop app, ${style}, ` +
      `crisp sharp legible typography, pixel-perfect, 4k.`,
    `Colors: ${palette}, with a single ${accent} accent used sparingly, plus small green and amber status dots. ` +
      `Describe colors only as materials, never as printed codes.`,
  ];

  if (input.sidebar && input.sidebar.length) {
    parts.push(
      `Left sidebar: the wordmark "${input.product}" at the top, then these nav items listed exactly once, ` +
        `single word each, no duplicates: ${input.sidebar.join(", ")}. The item "${active}" is highlighted in the ` +
        `${accent} accent; all other items are plain.`
    );
  } else {
    parts.push(`Left sidebar with the wordmark "${input.product}" and a short list of single-word nav items.`);
  }

  parts.push(`A slim top bar with a small round avatar on the right, and the screen title "${input.screen}" in the main panel.`);
  parts.push(`Main panel: ${input.layout}`);

  if (input.tags && input.tags.length) {
    parts.push(`Short technical tags shown as small pills (real text, they are short): ${input.tags.join(", ")}.`);
  }

  parts.push(
    `Text discipline: the ONLY real words are the wordmark, the sidebar nav items (once each), the screen title, ` +
      `and section/card titles. Every metric value is a short number; every table row, list row and body description ` +
      `is a thin horizontal placeholder bar with NO words. Charts are clean line, area, donut or bar shapes. ` +
      `Statuses are small colored dots.`
  );

  return { positive: parts.join(" "), negative: SCREEN_NEGATIVE };
}

/** Prompt for a real content asset. Photos/illustrations are allowed here. */
export function buildAssetPrompt(input: AssetInput): BuiltPrompt {
  const accent = input.accent ?? "electric violet";
  const palette = input.palette ?? "a cohesive brand palette";
  const style = input.style ? `, ${input.style}` : "";
  const noText = "text, words, letters, captions, watermark, signature, logo text, ui, buttons, low resolution, jpeg artifacts";

  switch (input.type) {
    case "photo":
      return {
        positive:
          `professional editorial photograph for ${input.product}: ${input.prompt}. ` +
          `Natural light, shallow depth of field, tasteful composition, brand tone in ${palette}${style}, 4k.`,
        negative: "illustration, cartoon, 3D render, cgi, oversaturated, " + noText,
      };
    case "illustration":
      return {
        positive:
          `modern vector editorial illustration for ${input.product}: ${input.prompt}. ` +
          `Clean shapes, flat with subtle depth, ${palette} with a ${accent} accent${style}, crisp, high quality.`,
        negative: "photograph, realistic photo, 3D render, noisy, " + noText,
      };
    case "icon":
      return {
        positive:
          `a single minimal ${input.prompt} icon for ${input.product}, simple geometric line-and-solid glyph, ` +
          `${accent} on a plain flat background, centered, generous padding, crisp vector look${style}.`,
        negative: "photograph, 3D, gradient mesh, multiple icons, busy, " + noText,
      };
    case "background":
      return {
        positive:
          `an abstract background texture for ${input.product}: ${input.prompt}. ` +
          `Soft ${palette}, subtle ${accent} glow, fine grain, calm and premium, seamless${style}, 4k.`,
        negative: "objects, people, ui, sharp focal subject, " + noText,
      };
    case "logo":
      return {
        positive:
          `a minimal abstract logo mark for ${input.product}: ${input.prompt}. ` +
          `Simple geometric symbol only (no text), ${accent} on a plain flat background, balanced, iconic${style}.`,
        negative: "wordmark, letters, text, photograph, 3D, complex, " + noText,
      };
  }
}
