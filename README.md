# mcp-design-models

A thin MCP server that turns a product idea into UI **screen mockups** plus a **complete
buildable spec** (design tokens, component trees with real copy, assets). It does no
rendering itself: it runs the **Studio "Design Factory" flow**, which owns the render queue
and the single-GPU guard, and returns the result.

```
MCP generate_product(idea, ...)
        │  POST /api/flows/flow_design_factory/correr?esperar=1
        │       { "parametros": { "brief": ... } }
        ▼
  Studio engine (queue + GPU guard)
        compositor (agent, plans)  →  telas (native render node)  →  analyst (writes spec)
        ▼
  { spec, manifest_path, screens[], assets[] }   ← the MCP waits and returns this
```

The prompt discipline that keeps a diffusion model from producing garbled clip-art (dark
surfaces, colours as materials not codes, only short labels as real text, table rows as
bars, one consistent sidebar) now lives inside the Studio engine's `telas` node, so it is
shared with the panel and driven through the same GPU guard as every other render.

## Tool

- **`generate_product`** — turn an `idea` into screens + assets + a spec.
  Optional hints: `product`, `theme` (`dark`/`light`), `palette`, `accent`, `max_screens`,
  `constraints`. Returns the analyst's spec JSON plus the rendered image paths and the
  `manifest.json` path. Sequential on one GPU, so it takes several minutes.

## Requirements

- A running **Studio** engine (`studio-api`) with the `telas` node type and the
  `flow_design_factory` flow registered — see [`studio-flow/`](studio-flow/).
- The Studio's ComfyUI with the image checkpoints installed (Z-Image Turbo by default;
  qwen-image and flux-schnell also available) — the Studio manages these.
- Node.js >= 20.

## Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `STUDIO_URL` | `http://127.0.0.1:28950` | Studio engine HTTP endpoint |
| `STUDIO_FLOW_ID` | `flow_design_factory` | The flow to run |

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
      "env": { "STUDIO_URL": "http://127.0.0.1:28950" }
    }
  }
}
```

## Output

The `telas` node writes the rendered screens, assets and `manifest.json` under
`<studio renders>/studio/design/<product>/`. `generate_product` returns the analyst's
spec (the source of truth for the build) together with those paths.

## License

MIT.
