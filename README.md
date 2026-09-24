# mcp-design-models

An MCP server that turns a product idea into UI **screen mockups**, driving a local
[qwen-image](https://github.com/QwenLM) pipeline through [ComfyUI]. It returns the
rendered images **and** a buildable component manifest — structure, not just a picture —
so a downstream agent can develop real screens from it.

The hard-won part is baked in: the prompt discipline that keeps a diffusion model from
producing garbled clip-art (dark surfaces, colors described as words, only short labels
rendered as real text, table/list rows drawn as bars, one consistent sidebar across
every screen). Callers don't need to know any of it.

## Tools

- **`render_screen`** — render one screen skeleton (placeholder-text mode): only the
  wordmark, sidebar nav, screen title and section titles are real; body and rows are bars.
  You pass a name, a prose layout, and (for a coherent product) the shared sidebar plus the
  active item. Returns the image path and a manifest entry.
- **`render_asset`** — render one real content asset: hero photo, illustration, icon,
  background or logo mark. Photos and people are allowed here (unlike screens). Uses fast
  flux for imagery and qwen for crisp glyphs by default; override with `model`.
- **`generate_product`** — turn an idea into a set of screens **plus** content assets.
  Either pass `screens` explicitly, or let the server plan them from `idea` when a planner
  is configured. Renders everything under one product folder and writes `manifest.json`.

Rendering runs on one GPU, sequentially — several screens take many minutes.

The output is three layers: **skeletons** (placeholder composition), **assets** (the real
imagery), and — when driven by the Studio flow in [`studio-flow/`](studio-flow/) — a
**complete build spec** (tokens, component trees, real copy). See `studio-flow/README.md`.

## Requirements

- A running ComfyUI with the image checkpoints installed:
  - **Z-Image Turbo** (default screen backend, ~15s/image): `z_image_turbo_bf16.safetensors`,
    `qwen_3_4b.safetensors`, `ae.safetensors`.
  - **qwen-image** (optional, max legibility, slower): `qwen_image_2512_fp8_e4m3fn.safetensors`,
    `qwen_2.5_vl_7b_fp8_scaled.safetensors`, `qwen_image_vae.safetensors`.
  - **flux-schnell** (content assets): `flux1-schnell-fp8.safetensors`.
- Node.js >= 20.

The screen backend defaults to `zimage`; set `MCP_SCREEN_MODEL=qwen` for maximum text
legibility, or pass `model` per call.

## Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `COMFY_URL` | `http://127.0.0.1:8188` | ComfyUI HTTP endpoint |
| `COMFY_OUTPUT_ROOT` | `/data/studio/renders` | Where ComfyUI writes images, for absolute paths |
| `MCP_PREFIX_BASE` | `studio/design/mcp` | Sub-path under the output root for renders + manifests |
| `QWEN_UNET` / `QWEN_CLIP` / `QWEN_VAE` | qwen defaults | Checkpoint filenames |
| `ANTHROPIC_API_KEY` | — | Optional; enables planning inside `generate_product` |
| `PLANNER_MODEL` | `claude-sonnet-4-5` | Model used for planning when a key is set |

Without a planner key, `generate_product` expects the caller to pass `screens` (a capable
agent client can plan them itself); `render_screen` always works.

## Build & run

```bash
npm install
npm run build
node dist/index.js
```

## Use from an MCP client

```json
{
  "mcpServers": {
    "design-models": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-desigh-models/dist/index.js"],
      "env": { "COMFY_URL": "http://127.0.0.1:8188" }
    }
  }
}
```

## Output

Each render lands under `COMFY_OUTPUT_ROOT/MCP_PREFIX_BASE/<product>/NN-<screen>.png`, and
`generate_product` writes a `manifest.json` in the same folder describing every screen
(name, active nav item, tags, image path, seed, and the exact prompt used).

## License

MIT.

[ComfyUI]: https://github.com/comfyanonymous/ComfyUI
