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

- **`render_screen`** — render one described screen. You pass a name, a prose layout of
  the main panel, and (for a coherent product) the shared sidebar plus the active item.
  Returns the image path and a manifest entry.
- **`generate_product`** — turn an idea into a set of screens. Either pass `screens`
  explicitly, or let the server plan them from `idea` when a planner is configured.
  Renders every screen with a shared sidebar and writes `manifest.json` beside the images.

Rendering runs on one GPU, sequentially — several screens take many minutes.

## Requirements

- A running ComfyUI with the qwen-image checkpoints installed:
  `qwen_image_2512_fp8_e4m3fn.safetensors`, `qwen_2.5_vl_7b_fp8_scaled.safetensors`,
  `qwen_image_vae.safetensors`.
- Node.js >= 20.

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
