#!/usr/bin/env node
/**
 * mcp-design-models
 *
 * Turns a product idea into UI screen mockups and the real imagery a site uses,
 * driving a local qwen/flux (ComfyUI) pipeline. Returns rendered files plus a
 * manifest, so a downstream agent gets buildable structure, not just pictures.
 *
 * Tools:
 *   render_screen     one screen skeleton (placeholder text) -> image + entry
 *   render_asset      one real content asset (hero/illustration/icon/...) -> image + entry
 *   generate_product  a set of screens (+ optional assets) -> render all + manifest.json
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildScreenPrompt, buildAssetPrompt, type ScreenInput, type AssetInput, type Theme, type AssetType } from "./prompt.js";
import { render, type Model } from "./comfy.js";

const OUTPUT_ROOT = process.env.COMFY_OUTPUT_ROOT ?? "/data/studio/renders";
const PREFIX_BASE = process.env.MCP_PREFIX_BASE ?? "studio/design/mcp";
const PLANNER_MODEL = process.env.PLANNER_MODEL ?? "claude-sonnet-4-5";
// backend for screen skeletons: "zimage" (turbo, ~15s, default) or "qwen" (slower, max legibility)
const SCREEN_MODEL = (process.env.MCP_SCREEN_MODEL as Model) ?? "zimage";

const slug = (s: string) =>
  (s || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "item";

interface ScreenEntry {
  screen: string; active: string; tags: string[];
  image_path: string; filename: string; seed: number; prompt: string; negative: string;
}
interface AssetEntry {
  role: string; type: AssetType; model: Model;
  image_path: string; filename: string; seed: number; prompt: string;
}
interface Manifest {
  product: string; idea?: string; theme: Theme;
  palette?: string; accent?: string; sidebar?: string[];
  screens: ScreenEntry[]; assets: AssetEntry[]; created_at: string;
}

// default backend per asset type: fast flux for imagery, qwen for crisp glyphs
const ASSET_MODEL: Record<AssetType, Model> = {
  photo: "flux", illustration: "flux", background: "flux", icon: "qwen", logo: "qwen",
};

async function renderScreenEntry(input: ScreenInput, productSlug: string, index: number, model: Model = SCREEN_MODEL): Promise<ScreenEntry> {
  const { positive, negative } = buildScreenPrompt(input);
  const prefix = `${PREFIX_BASE}/${productSlug}/${String(index).padStart(2, "0")}-${slug(input.screen)}`;
  const r = await render({ positive, negative, prefix, model });
  return { screen: input.screen, active: input.active ?? input.screen, tags: input.tags ?? [], image_path: r.path, filename: r.filename, seed: r.seed, prompt: positive, negative };
}

async function renderAssetEntry(input: AssetInput, productSlug: string, model?: Model, width?: number, height?: number): Promise<AssetEntry> {
  const { positive, negative } = buildAssetPrompt(input);
  const m = model ?? ASSET_MODEL[input.type];
  const prefix = `${PREFIX_BASE}/${productSlug}/assets/${slug(input.role)}`;
  const r = await render({ positive, negative, prefix, model: m, width, height });
  return { role: input.role, type: input.type, model: m, image_path: r.path, filename: r.filename, seed: r.seed, prompt: positive };
}

/** Optional: plan screens from an idea via the Anthropic API, if a key is set. */
async function planScreens(idea: string, maxScreens: number, theme: Theme) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const sys =
    "You are a senior product designer. Given a product idea, return STRICT JSON only (no prose): " +
    '{"product":string,"palette":string(words),"accent":string(words),"sidebar":string[] (single words, once each),' +
    '"screens":[{"screen":string,"active":string,"layout":string,"tags":string[]}]}. ' +
    `At most ${maxScreens} screens, ${theme} theme, compose each layout from real dashboard components; keep the sidebar identical across screens.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: PLANNER_MODEL, max_tokens: 4096, system: sys, messages: [{ role: "user", content: `Product idea:\n${idea}` }] }),
  });
  const body: any = await res.json();
  const text: string = (body.content ?? []).map((b: any) => b.text ?? "").join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("planner did not return JSON");
  return JSON.parse(match[0]);
}

const server = new McpServer({ name: "mcp-design-models", version: "0.2.0" });

server.tool(
  "render_screen",
  "Render one UI screen skeleton with the local qwen pipeline. Placeholder-text mode: only the wordmark, sidebar nav, " +
    "screen title and section titles are real; body/rows are bars. Give the shared sidebar and the active item for a coherent product. A render takes a few minutes.",
  {
    product: z.string(), screen: z.string(),
    layout: z.string().describe("Prose: which components, where, proportions"),
    theme: z.enum(["dark", "light"]).optional(),
    palette: z.string().optional(), accent: z.string().optional(),
    sidebar: z.array(z.string()).optional(), active: z.string().optional(),
    tags: z.array(z.string()).optional(), style: z.string().optional(),
    model: z.enum(["qwen", "zimage"]).optional().describe("Screen backend: qwen (slow, very legible) or zimage (turbo, fast). Defaults to MCP_SCREEN_MODEL."),
  },
  async (args) => {
    const entry = await renderScreenEntry(args as ScreenInput, slug(args.product), 0, args.model as Model | undefined ?? SCREEN_MODEL);
    return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
  }
);

server.tool(
  "render_asset",
  "Render one real content asset (hero photo, illustration, icon, background, or logo mark) for a product. Unlike screens, " +
    "photos and people are allowed here. Defaults to fast flux for imagery and qwen for glyphs; override with `model`.",
  {
    product: z.string(),
    role: z.string().describe('What it is for, e.g. "landing hero"'),
    type: z.enum(["photo", "illustration", "icon", "background", "logo"]),
    prompt: z.string().describe("Scene / subject"),
    palette: z.string().optional(), accent: z.string().optional(), style: z.string().optional(),
    model: z.enum(["qwen", "flux", "zimage"]).optional(),
    width: z.number().int().optional(), height: z.number().int().optional(),
  },
  async (args) => {
    const entry = await renderAssetEntry(args as AssetInput, slug(args.product), args.model as Model | undefined, args.width, args.height);
    return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
  }
);

server.tool(
  "generate_product",
  "Render a whole product: a set of screens (passed in, or planned from `idea` if a planner is configured) plus optional " +
    "content assets, all under one product folder, and write manifest.json. Sequential on one GPU, so it takes many minutes.",
  {
    product: z.string().optional(), idea: z.string(),
    theme: z.enum(["dark", "light"]).optional(),
    max_screens: z.number().int().min(1).max(10).optional(),
    sidebar: z.array(z.string()).optional(), palette: z.string().optional(), accent: z.string().optional(),
    screen_model: z.enum(["qwen", "zimage"]).optional().describe("Backend for screens (default MCP_SCREEN_MODEL)"),
    screens: z.array(z.object({ screen: z.string(), layout: z.string(), active: z.string().optional(), tags: z.array(z.string()).optional() })).optional(),
    assets: z.array(z.object({ role: z.string(), type: z.enum(["photo", "illustration", "icon", "background", "logo"]), prompt: z.string(), model: z.enum(["qwen", "flux", "zimage"]).optional() })).optional(),
  },
  async (args) => {
    const theme: Theme = args.theme ?? "dark";
    const maxScreens = args.max_screens ?? 6;
    let { product, sidebar, palette, accent, screens } = args as any;

    if (!screens || !screens.length) {
      const plan = await planScreens(args.idea, maxScreens, theme);
      if (!plan) {
        return { isError: true, content: [{ type: "text", text: "No `screens` provided and no planner configured (set ANTHROPIC_API_KEY, or pass `screens`). The calling agent can plan the screens and pass them in." }] };
      }
      product = product ?? plan.product; sidebar = sidebar ?? plan.sidebar;
      palette = palette ?? plan.palette; accent = accent ?? plan.accent; screens = plan.screens;
    }

    product = product ?? "Product";
    const productSlug = slug(product);
    const screenOut: ScreenEntry[] = [];
    let i = 0;
    for (const s of screens.slice(0, maxScreens)) {
      screenOut.push(await renderScreenEntry({ product, screen: s.screen, layout: s.layout, theme, palette, accent, sidebar, active: s.active ?? s.screen, tags: s.tags }, productSlug, i++, (args.screen_model as Model | undefined) ?? SCREEN_MODEL));
    }

    const assetOut: AssetEntry[] = [];
    for (const a of args.assets ?? []) {
      assetOut.push(await renderAssetEntry({ product, role: a.role, type: a.type as AssetType, prompt: a.prompt, palette, accent }, productSlug, a.model as Model | undefined));
    }

    const manifest: Manifest = { product, idea: args.idea, theme, palette, accent, sidebar, screens: screenOut, assets: assetOut, created_at: new Date().toISOString() };
    const manifestPath = `${OUTPUT_ROOT}/${PREFIX_BASE}/${productSlug}/manifest.json`;
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return { content: [{ type: "text", text: JSON.stringify({ manifest_path: manifestPath, ...manifest }, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
