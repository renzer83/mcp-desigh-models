# Studio flow — Design Factory

The default flow that turns a product idea into screens + assets + a complete build spec,
by pairing this MCP with two agents inside the Studio engine.

```
idea (parameter)
      │
  ┌───▼─────────┐   uses the design-models MCP
  │ compositor  │   plan screens + real components → generate_product → skeletons + assets + manifest.json
  └───┬─────────┘
  ┌───▼─────────┐   reads the images + manifest
  │  analyst    │   → complete spec (tokens, component trees, real copy, assets, responsive)
  └───┬─────────┘
      ▼
  spec JSON  →  the calling factory agent builds from it
```

- The **image is a placeholder skeleton** (composition only). The **spec is the source of truth**
  (real copy, config, data shapes). The **assets** are the real imagery the site drops in.

## Files

- `flow.json` — the Studio flow graph (two `agente` nodes). Import via `PUT /api/flows/flow_design_factory`.
- `agents/compositor.md`, `agents/analyst.md` — the agent prompts (also inlined in `flow.json`).
- `spec-schema.json` — the schema the analyst's spec conforms to.

## One-time setup

1. Build and register the MCP (see the repo root README), then register it in the Studio
   panel's MCP section under the name **`design-models`** (the `compositor` node selects it
   by that name). The MCP must reach the same ComfyUI the Studio uses.
2. Import the flow:
   ```bash
   curl -X PUT http://127.0.0.1:28950/api/flows/flow_design_factory \
     -H 'Content-Type: application/json' --data @flow.json
   ```

## Run it with an idea (the parameter)

The product brief lives in the `compositor` node's `objetivo`, between the markers
`<<PRODUCT_BRIEF>> ... <<END_PRODUCT_BRIEF>>`. A factory worker sets it per project by
`GET`ting the flow, replacing the text between those markers, `PUT`ting it back, then
`POST /api/flows/flow_design_factory/correr`. This mirrors how Studio already parametrizes
agent briefs.

The run returns the analyst's spec; the rendered screens, assets and `manifest.json` live
under `COMFY_OUTPUT_ROOT/MCP_PREFIX_BASE/<product>/`.

## Without a GPU

If ComfyUI is not available, point `COMFY_URL` at another host, or drive only the spec side
(the analyst) — the pipeline degrades to structure + copy without freshly rendered images.
