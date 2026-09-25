#!/usr/bin/env node
/**
 * mcp-design-models — cliente fino do Studio.
 *
 * Turns a product idea into UI screen mockups + a complete buildable spec. All the
 * heavy lifting (planning, rendering on the GPU, writing the spec) happens inside the
 * Studio engine's "Design Factory" flow, which owns the queue and the GPU guard. This
 * MCP is a thin trigger: it forwards the idea as a per-run parameter, runs the flow
 * synchronously, waits, and returns the analyst's spec plus the rendered image paths.
 *
 * One tool:
 *   generate_product(idea, ...) -> { spec, manifest_path, screens[], assets[] }
 *
 * Config (env):
 *   STUDIO_URL       default http://127.0.0.1:28950
 *   STUDIO_FLOW_ID   default flow_design_factory
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetch, Agent } from "undici";

const STUDIO_URL = (process.env.STUDIO_URL ?? "http://127.0.0.1:28950").replace(/\/+$/, "");
const FLOW_ID = process.env.STUDIO_FLOW_ID ?? "flow_design_factory";

// A design run renders many images on one GPU and takes many minutes; disable the
// client-side header/body timeouts so the synchronous ?esperar=1 call can wait it out.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 });

interface Passo {
  no_id: string;
  estado: string;
  saida: unknown;
  erro?: string | null;
}
interface Run {
  id: string;
  estado: string;
  erro?: string | null;
  passos?: Passo[];
}

/** Build the product brief the compositor reads as {{ param.brief }}. */
function buildBrief(a: {
  idea: string; product?: string; theme?: string; palette?: string;
  accent?: string; max_screens?: number; constraints?: string;
}): string {
  const lines = [a.idea.trim()];
  if (a.product) lines.push(`Product name: ${a.product}`);
  if (a.theme) lines.push(`Theme: ${a.theme}`);
  if (a.palette) lines.push(`Palette (in words): ${a.palette}`);
  if (a.accent) lines.push(`Accent colour: ${a.accent}`);
  if (a.max_screens) lines.push(`Screens: at most ${a.max_screens}.`);
  if (a.constraints) lines.push(`Constraints: ${a.constraints}`);
  return lines.join("\n");
}

const server = new McpServer({ name: "mcp-design-models", version: "0.3.0" });

server.tool(
  "generate_product",
  "Turn a product idea into UI screen mockups plus a complete buildable spec (design tokens, " +
    "component trees with real copy, assets). Runs the Studio 'Design Factory' flow (compositor plans " +
    "-> native render on the GPU queue -> analyst writes the spec) and returns the spec and image paths. " +
    "Sequential on one GPU, so it takes several minutes.",
  {
    idea: z.string().describe("The product idea, audience and tone."),
    product: z.string().optional().describe("Product name, if you want to fix it."),
    theme: z.enum(["dark", "light"]).optional(),
    palette: z.string().optional().describe("Palette in words (e.g. 'graphite and off-white')."),
    accent: z.string().optional().describe("Accent colour in words (e.g. 'electric violet')."),
    max_screens: z.number().int().min(1).max(10).optional(),
    constraints: z.string().optional().describe("Any extra constraints for the design."),
  },
  async (args) => {
    const brief = buildBrief(args);
    const parametros = {
      brief,
      product: args.product,
      theme: args.theme,
      palette: args.palette,
      accent: args.accent,
      max_screens: args.max_screens,
    };

    const url = `${STUDIO_URL}/api/flows/${FLOW_ID}/correr?esperar=1`;
    let run: Run;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parametros }),
        dispatcher,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { isError: true, content: [{ type: "text", text: `Studio ${res.status} at ${url}: ${text}` }] };
      }
      run = (await res.json()) as Run;
    } catch (e: any) {
      return { isError: true, content: [{ type: "text", text: `Could not reach the Studio at ${url}: ${e?.message ?? e}` }] };
    }

    const passos = run.passos ?? [];
    if (run.estado === "falhou") {
      const falhou = passos.find((p) => p.estado === "falhou");
      const motivo = falhou?.erro ?? run.erro ?? "unknown error";
      return { isError: true, content: [{ type: "text", text: `The Design Factory run failed: ${motivo}` }] };
    }

    const analyst = passos.find((p) => p.no_id === "analyst");
    const telas = passos.find((p) => p.no_id === "telas");
    const spec = analyst?.saida ?? null;
    if (!spec) {
      return { isError: true, content: [{ type: "text", text: `The run finished but produced no spec (analyst node output empty). Run ${run.id}.` }] };
    }

    const t = (telas?.saida ?? {}) as any;
    const result = {
      run_id: run.id,
      manifest_path: t.manifest_path ?? null,
      screens: (t.screens ?? []).map((s: any) => ({ screen: s.screen, image_path: s.image_path })),
      assets: (t.assets ?? []).map((a: any) => ({ role: a.role, type: a.type, image_path: a.image_path })),
      spec,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
