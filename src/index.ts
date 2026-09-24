#!/usr/bin/env node
/**
 * mcp-design-models
 *
 * An MCP server that turns a product idea into UI screen mockups by driving a
 * local qwen-image (ComfyUI) pipeline. It returns both the rendered images and
 * a buildable component manifest, so a downstream agent gets structure, not just
 * a picture.
 *
 * Tools:
 *   render_screen     render one described screen -> image + manifest entry
 *   generate_product  plan N screens for an idea (or take them) -> render all
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildScreenPrompt, type ScreenInput, type Theme } from "./prompt.js";
import { render } from "./comfy.js";

const OUTPUT_ROOT = process.env.COMFY_OUTPUT_ROOT ?? "/data/studio/renders";
const PREFIX_BASE = process.env.MCP_PREFIX_BASE ?? "studio/design/mcp";
const PLANNER_MODEL = process.env.PLANNER_MODEL ?? "claude-sonnet-4-5";

const slug = (s: string) =>
  (s || "screen").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "screen";

interface ManifestScreen {
  screen: string;
  active: string;
  tags: string[];
  image_path: string;
  filename: string;
  seed: number;
  prompt: string;
  negative: string;
}
interface Manifest {
  product: string;
  idea?: string;
  theme: Theme;
  palette?: string;
  accent?: string;
  sidebar?: string[];
  screens: ManifestScreen[];
  created_at: string;
}

async function loadManifest(path: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

async function renderOne(input: ScreenInput, productSlug: string, index: number): Promise<ManifestScreen> {
  const { positive, negative } = buildScreenPrompt(input);
  const prefix = `${PREFIX_BASE}/${productSlug}/${String(index).padStart(2, "0")}-${slug(input.screen)}`;
  const r = await render({ positive, negative, prefix });
  return {
    screen: input.screen,
    active: input.active ?? input.screen,
    tags: input.tags ?? [],
    image_path: r.path,
    filename: r.filename,
    seed: r.seed,
    prompt: positive,
    negative,
  };
}

/** Optional: plan screens from an idea using the Anthropic API, if a key is set. */
async function planScreens(idea: string, maxScreens: number, theme: Theme) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const sys =
    "You are a senior product designer. Given a product idea, return STRICT JSON only " +
    "(no prose) describing the authenticated app's core screens to prototype. Shape: " +
    '{"product":string,"palette":string(words),"accent":string(words),"sidebar":string[] (single words, once each),' +
    '"screens":[{"screen":string,"active":string(one of sidebar),"layout":string(what components go where, prose),' +
    '"tags":string[] (short technical labels)}]}. ' +
    `Pick at most ${maxScreens} screens. Theme is ${theme}. Compose each layout from real dashboard ` +
    "components (stat cards, data tables, config forms, charts, side detail panels). Keep the sidebar identical across screens.";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      max_tokens: 4096,
      system: sys,
      messages: [{ role: "user", content: `Product idea:\n${idea}` }],
    }),
  });
  const body: any = await res.json();
  const text: string = (body.content ?? []).map((b: any) => b.text ?? "").join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("planner did not return JSON");
  return JSON.parse(match[0]);
}

const server = new McpServer({ name: "mcp-design-models", version: "0.1.0" });

server.tool(
  "render_screen",
  "Render one UI screen mockup with the local qwen pipeline. Give the screen a name, a prose layout of the main panel, " +
    "and (for consistency across a product) the shared sidebar items plus which one is active. Returns the image path and a manifest entry. " +
    "Text discipline (dark theme, colors as words, only short labels real, rows as bars) is applied for you. A render takes a few minutes.",
  {
    product: z.string().describe("Product / wordmark name, kept short"),
    screen: z.string().describe('Screen name, e.g. "Overview"'),
    layout: z.string().describe("Prose description of the main panel: which components, where, proportions"),
    theme: z.enum(["dark", "light"]).optional(),
    palette: z.string().optional().describe("Palette in words, e.g. 'near-black graphite with dark charcoal panels'"),
    accent: z.string().optional().describe("Single accent color in words, e.g. 'electric violet'"),
    sidebar: z.array(z.string()).optional().describe("Sidebar nav items, once each, shared across screens"),
    active: z.string().optional().describe("Which sidebar item is highlighted (defaults to the screen name)"),
    tags: z.array(z.string()).optional().describe('Short technical tags allowed as real text, e.g. ["RTX 4090","QLoRA"]'),
    style: z.string().optional().describe("Extra style words"),
  },
  async (args) => {
    const productSlug = slug(args.product);
    const entry = await renderOne(args as ScreenInput, productSlug, 0);
    return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
  }
);

server.tool(
  "generate_product",
  "Turn a product idea into a set of screen mockups. Either pass `screens` explicitly, or (if the server has a planner " +
    "configured) let it plan them from `idea`. Renders every screen with a shared sidebar and writes a manifest.json next to the images. " +
    "Rendering is sequential on one GPU, so several screens take many minutes.",
  {
    product: z.string().optional().describe("Product name; inferred from the plan if omitted"),
    idea: z.string().describe("The product idea / brief"),
    theme: z.enum(["dark", "light"]).optional(),
    max_screens: z.number().int().min(1).max(10).optional().describe("Cap on screens (default 6)"),
    sidebar: z.array(z.string()).optional().describe("Shared sidebar; inferred from the plan if omitted"),
    palette: z.string().optional(),
    accent: z.string().optional(),
    screens: z
      .array(
        z.object({
          screen: z.string(),
          layout: z.string(),
          active: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
      )
      .optional()
      .describe("Explicit screens to render; skips internal planning"),
  },
  async (args) => {
    const theme: Theme = args.theme ?? "dark";
    const maxScreens = args.max_screens ?? 6;

    let product = args.product;
    let sidebar = args.sidebar;
    let palette = args.palette;
    let accent = args.accent;
    let screens = args.screens;

    if (!screens || !screens.length) {
      const plan = await planScreens(args.idea, maxScreens, theme);
      if (!plan) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "No screens were provided and no planner is configured (set ANTHROPIC_API_KEY, or call render_screen per " +
                "screen, or pass `screens`). The caller can plan the screens itself and pass them in.",
            },
          ],
        };
      }
      product = product ?? plan.product;
      sidebar = sidebar ?? plan.sidebar;
      palette = palette ?? plan.palette;
      accent = accent ?? plan.accent;
      screens = plan.screens;
    }

    product = product ?? "Product";
    const productSlug = slug(product);
    const out: ManifestScreen[] = [];
    let i = 0;
    for (const s of screens!.slice(0, maxScreens)) {
      out.push(
        await renderOne(
          {
            product,
            screen: s.screen,
            layout: s.layout,
            theme,
            palette,
            accent,
            sidebar,
            active: s.active ?? s.screen,
            tags: s.tags,
          },
          productSlug,
          i++
        )
      );
    }

    const manifest: Manifest = {
      product,
      idea: args.idea,
      theme,
      palette,
      accent,
      sidebar,
      screens: out,
      created_at: new Date().toISOString(),
    };
    const manifestPath = `${OUTPUT_ROOT}/${PREFIX_BASE}/${productSlug}/manifest.json`;
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return {
      content: [
        { type: "text", text: JSON.stringify({ manifest_path: manifestPath, ...manifest }, null, 2) },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
