/**
 * Drives a local ComfyUI instance to render one image.
 *
 * Two backends:
 *   - qwen: qwen-image (UNET + qwen CLIP + VAE, AuraFlow shift, euler/simple).
 *     Best for UI skeletons and anything needing legible text; slow.
 *   - flux: flux-schnell (4 steps, distilled, no negative). Fast; good for
 *     content assets (hero art, backgrounds, illustrations).
 */

const COMFY_URL = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
const OUTPUT_ROOT = process.env.COMFY_OUTPUT_ROOT ?? "/data/studio/renders";

const QWEN_UNET = process.env.QWEN_UNET ?? "qwen_image_2512_fp8_e4m3fn.safetensors";
const QWEN_CLIP = process.env.QWEN_CLIP ?? "qwen_2.5_vl_7b_fp8_scaled.safetensors";
const QWEN_VAE = process.env.QWEN_VAE ?? "qwen_image_vae.safetensors";
const FLUX_CKPT = process.env.FLUX_CKPT ?? "flux1-schnell-fp8.safetensors";
const ZIMAGE_UNET = process.env.ZIMAGE_UNET ?? "z_image_turbo_bf16.safetensors";
const ZIMAGE_CLIP = process.env.ZIMAGE_CLIP ?? "qwen_3_4b.safetensors";
const ZIMAGE_VAE = process.env.ZIMAGE_VAE ?? "ae.safetensors";

export type Model = "qwen" | "flux" | "zimage";

export interface RenderOptions {
  positive: string;
  negative?: string;
  prefix: string;
  model?: Model;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  shift?: number;
  seed?: number;
  signal?: AbortSignal;
}

export interface RenderResult {
  path: string;
  filename: string;
  subfolder: string;
  seed: number;
  promptId: string;
  model: Model;
}

function qwenGraph(o: { positive: string; negative: string; prefix: string; width: number; height: number; steps: number; cfg: number; shift: number; seed: number; }) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: QWEN_UNET, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: QWEN_CLIP, type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: QWEN_VAE } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: o.positive } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: o.negative } },
    "6": { class_type: "EmptySD3LatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    "7": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: o.shift } },
    "8": { class_type: "KSampler", inputs: { model: ["7", 0], seed: o.seed, steps: o.steps, cfg: o.cfg, sampler_name: "euler", scheduler: "simple", positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], denoise: 1.0 } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: o.prefix } },
  };
}

function fluxGraph(o: { positive: string; prefix: string; width: number; height: number; steps: number; seed: number; }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: FLUX_CKPT } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: o.positive } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "" } },
    "4": { class_type: "EmptySD3LatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { model: ["1", 0], seed: o.seed, steps: o.steps, cfg: 1.0, sampler_name: "euler", scheduler: "simple", positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], denoise: 1.0 } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: o.prefix } },
  };
}

/** Z-Image Turbo: 8-step distilled, cfg 1, res_multistep/simple, AuraFlow shift 3.
 *  Much faster than qwen and good with text — a strong screen-skeleton backend. */
function zimageGraph(o: { positive: string; negative: string; prefix: string; width: number; height: number; steps: number; cfg: number; shift: number; seed: number; }) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: ZIMAGE_UNET, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: ZIMAGE_CLIP, type: "lumina2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: ZIMAGE_VAE } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: o.positive } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: o.negative } },
    "6": { class_type: "EmptySD3LatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    "7": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: o.shift } },
    "8": { class_type: "KSampler", inputs: { model: ["7", 0], seed: o.seed, steps: o.steps, cfg: o.cfg, sampler_name: "res_multistep", scheduler: "simple", positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], denoise: 1.0 } },
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
  const model: Model = opts.model ?? "qwen";
  const seed = opts.seed && opts.seed > 0 ? opts.seed : Math.floor(Math.random() * 2 ** 31);
  const landscape = model === "qwen" || model === "zimage";
  const width = opts.width ?? (landscape ? 1536 : 1024);
  const height = opts.height ?? 1024;

  let graph: Record<string, unknown>;
  if (model === "qwen") {
    graph = qwenGraph({ positive: opts.positive, negative: opts.negative ?? "", prefix: opts.prefix, width, height, steps: opts.steps ?? 36, cfg: opts.cfg ?? 2.5, shift: opts.shift ?? 3.1, seed });
  } else if (model === "zimage") {
    graph = zimageGraph({ positive: opts.positive, negative: opts.negative ?? "", prefix: opts.prefix, width, height, steps: opts.steps ?? 8, cfg: opts.cfg ?? 1.0, shift: opts.shift ?? 3.0, seed });
  } else {
    graph = fluxGraph({ positive: opts.positive, prefix: opts.prefix, width, height, steps: opts.steps ?? 4, seed });
  }

  const res = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph }),
    signal: opts.signal,
  });
  const body: any = await res.json();
  if (body.error || (body.node_errors && Object.keys(body.node_errors).length)) {
    throw new Error(`ComfyUI rejected the graph: ${JSON.stringify(body.error ?? body.node_errors)}`);
  }
  const promptId: string = body.prompt_id;

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
        return { path, filename, subfolder, seed, promptId, model };
      }
    }
  }
  throw new Error(`ComfyUI job ${promptId} did not finish within the time limit`);
}
