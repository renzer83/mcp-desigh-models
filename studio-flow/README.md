# Studio flow — Design Factory

The flow that turns a product idea into screens + assets + a complete build spec, entirely
inside the Studio engine. The MCP (repo root) is just a thin trigger for it.

```
idea (per-run parameter: {{ param.brief }})
      │
  ┌───▼─────────┐   agent — PLANS only (no rendering)
  │ compositor  │   plan screens + real components + assets + palette → JSON
  └───┬─────────┘
  ┌───▼─────────┐   native `telas` node — RENDERS on the Studio queue + GPU guard
  │   telas     │   screen skeletons + assets (prompt discipline built in) → manifest.json
  └───┬─────────┘
  ┌───▼─────────┐   agent — reads the images + manifest
  │  analyst    │   → complete spec (tokens, component trees, real copy, assets, responsive)
  └───┬─────────┘
      ▼
  spec JSON  →  the calling factory agent builds from it
```

- The **image is a placeholder skeleton** (composition only). The **spec is the source of truth**
  (real copy, config, data shapes). The **assets** are the real imagery the site drops in.
- Rendering is a **native Studio node** (`telas`), not an MCP call — so it runs through the
  queue and the single-GPU guard, one image at a time. There is no circular dependency.

## Files

- `flow.json` — the Studio flow graph (compositor → telas → analyst). The authoritative
  copy lives in the Studio repo at `workflows/design_factory.json`; this is a mirror.
- `agents/compositor.md`, `agents/analyst.md` — the agent prompts.
- `spec-schema.json` — the schema the analyst's spec conforms to.

## One-time setup

The `telas` node type and the flow ship with the Studio engine. Register/update the flow
from the Studio repo:

```bash
node workflows/build_design_factory_flow.mjs
```

(Restart `studio-api` first if the `telas` node type is newly deployed.)

## Run it with an idea

The idea is a **per-run parameter**, not a stored edit:

```bash
curl -X POST 'http://127.0.0.1:28950/api/flows/flow_design_factory/correr?esperar=1' \
  -H 'Content-Type: application/json' \
  --data '{"parametros":{"brief":"a task-tracking SaaS for indie devs, dark, technical tone"}}'
```

The call is synchronous: it returns the finished run, whose `analyst` step output is the
spec and whose `telas` step output has the `manifest_path` and image paths. The MCP's
`generate_product` wraps exactly this.
