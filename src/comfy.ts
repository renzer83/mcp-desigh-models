/**
 * Drives a local ComfyUI instance running qwen-image to render one mockup.
 * The graph mirrors the known-good qwen-image text-to-image pipeline
 * (UNET + qwen CLIP + VAE, AuraFlow model-sampling shift, euler/simple KSampler).
 */

const COMFY_URL = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
/** Where ComfyUI writes SaveImage output; used to build absolute paths. */
const OUTPUT_ROOT = process.env.COMFY_OUTPUT_ROOT ?? "/data/studio/renders";

const UNET = process.env.QWEN_UNET ?? "qwen_image_2512_fp8_e4m3fn.safetensors";
const CLIP = process.env.QWEN_CLIP ?? "qwen_2.5_vl_7b_fp8_scaled.safetensors";
const VAE = process.env.QWEN_VAE ?? "qwen_image_vae.safetensors";

export interface RenderOptions {
  positive: string;
  negative: string;
  prefix: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  shift?: number;
  seed?: number;
  /** Abort signal so a caller can cancel a long render. */
  signal?: AbortSignal;
}

export interface RenderResult {
  /** Absolute path on disk, best-effort from COMFY_OUTPUT_ROOT + subfolder. */
  path: string;
  /** ComfyUI-relative filename. */
  filename: string;
  subfolder: string;
  seed: number;
  promptId: string;
}

function graph(o: Required<Pick<RenderOptions, "positive" | "negative" | "prefix">> & {
  width: number; height: number; steps: number; cfg: number; shift: number; seed: number;
}) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: VAE } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: o.positive } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: o.negative } },
    "6": { class_type: "EmptySD3LatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    "7": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: o.shift } },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["7", 0], seed: o.seed, steps: o.steps, cfg: o.cfg,
        sampler_name: "euler", scheduler: "simple",
        positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], denoise: 1.0,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: o.prefix } },
  };
}

async function jget(url: string, signal?: AbortSignal): Promise<any> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`ComfyUI GET ${url} -> ${r.status}`);
  return r.json();
}

export async function render(opts: RenderOptions): Promise<RenderResult> {
  const seed = opts.seed && opts.seed > 0 ? opts.seed : Math.floor(Math.random() * 2 ** 31);
  const g = graph({
    positive: opts.positive, negative: opts.negative, prefix: opts.prefix,
    width: opts.width ?? 1536, height: opts.height ?? 1024,
    steps: opts.steps ?? 36, cfg: opts.cfg ?? 2.5, shift: opts.shift ?? 3.1, seed,
  });

  const res = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: g }),
    signal: opts.signal,
  });
  const body: any = await res.json();
  if (body.error || (body.node_errors && Object.keys(body.node_errors).length)) {
    throw new Error(`ComfyUI rejected the graph: ${JSON.stringify(body.error ?? body.node_errors)}`);
  }
  const promptId: string = body.prompt_id;

  // Poll history until this job appears with outputs.
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("render aborted");
    await new Promise((r) => setTimeout(r, 3000));
    const hist = await jget(`${COMFY_URL}/history/${promptId}`, opts.signal);
    const entry = hist[promptId];
    if (!entry) continue;
    for (const node of Object.values<any>(entry.outputs ?? {})) {
      for (const img of node.images ?? []) {
        const subfolder: string = img.subfolder ?? "";
        const filename: string = img.filename;
        const path = `${OUTPUT_ROOT}/${subfolder ? subfolder + "/" : ""}${filename}`.replace(/\/+/g, "/");
        return { path, filename, subfolder, seed, promptId };
      }
    }
  }
  throw new Error(`ComfyUI job ${promptId} did not finish within the time limit`);
}
