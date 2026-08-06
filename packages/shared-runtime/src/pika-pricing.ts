export interface PikaCatalogPriceTier {
  spec: Record<string, unknown>;
  micro_usd: number;
}

export interface PikaCatalogPricingComponent {
  role?: string;
  unit: { type: string; quantity: number; included?: number };
  starting_at?: PikaCatalogPriceTier;
  price_tiers?: PikaCatalogPriceTier[];
}

export interface PikaCatalogEntry {
  api_id: string;
  display_pricing?: { components?: PikaCatalogPricingComponent[] };
}

export interface PikaQuoteComponent {
  unitType: string;
  quantity: number;
  unitMicroUsd: number;
  subtotalMicroUsd: number;
}

export interface PikaCatalogQuote {
  estimatedCostMicroUsd: number | undefined;
  complete: boolean;
  currency: "USD";
  pricingSource: "pika-catalog" | "unavailable";
  components: PikaQuoteComponent[];
}

const PIKA_CATALOG_BASE_URL = "https://api.dev.pika.art";
const BILLING_SCALAR_KEYS = new Set([
  "resolution",
  "duration",
  "duration_s",
  "num_images",
  "aspect_ratio",
  "output_format",
  "quality",
  "mode",
  "language",
  "sample_rate",
  "bitrate",
  "channels",
  "fps",
  "width",
  "height",
]);

export function pikaBillingBasis(input: Record<string, unknown>): Record<string, unknown> {
  const basis: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (BILLING_SCALAR_KEYS.has(key) && ["string", "number", "boolean"].includes(typeof value)) {
      basis[key] = value;
      continue;
    }
    if (Array.isArray(value) && /(?:_urls|_images|_videos|references)$/.test(key)) {
      basis[`${key}_count`] = value.length;
    }
  }
  return basis;
}

function matchingTier(component: PikaCatalogPricingComponent, input: Record<string, unknown>): PikaCatalogPriceTier | undefined {
  const candidates = [...(component.price_tiers ?? [])]
    .filter((tier) => Object.entries(tier.spec).every(([key, value]) => input[key] === value))
    .sort((a, b) => Object.keys(b.spec).length - Object.keys(a.spec).length);
  return candidates[0] ?? component.starting_at;
}

function arrayLength(input: Record<string, unknown>, key: string): number {
  return Array.isArray(input[key]) ? input[key].length : 0;
}

function inputImageCount(input: Record<string, unknown>): number {
  return arrayLength(input, "image_urls")
    + ["image", "image_url", "end_image_url", "first_frame_image", "last_frame_image", "mask_image_url"]
      .filter((key) => typeof input[key] === "string" && input[key]).length;
}

function quantityFor(component: PikaCatalogPricingComponent, input: Record<string, unknown>): number | undefined {
  const duration = typeof input.duration_s === "number"
    ? input.duration_s
    : typeof input.duration === "number"
      ? input.duration
      : undefined;
  switch (component.unit.type) {
    case "second":
    case "output_second":
      return component.role === "input" ? undefined : duration;
    case "minute":
      return duration === undefined ? undefined : duration / 60;
    case "image":
      return typeof input.num_images === "number" ? input.num_images : 1;
    case "input_image":
      return inputImageCount(input);
    case "request":
      return 1;
    case "video_input_second":
      return undefined;
    default:
      return undefined;
  }
}

export function quotePikaCatalogRequest(options: {
  operation: string;
  input: Record<string, unknown>;
  catalog: PikaCatalogEntry;
}): PikaCatalogQuote {
  const components: PikaQuoteComponent[] = [];
  let complete = options.catalog.api_id === options.operation;
  for (const component of options.catalog.display_pricing?.components ?? []) {
    const tier = matchingTier(component, options.input);
    const rawQuantity = quantityFor(component, options.input);
    if (!tier || rawQuantity === undefined) {
      complete = false;
      continue;
    }
    const quantity = Math.max(0, rawQuantity - (component.unit.included ?? 0));
    const pricedUnits = quantity / Math.max(1, component.unit.quantity);
    const subtotalMicroUsd = Math.round(pricedUnits * tier.micro_usd);
    components.push({
      unitType: component.unit.type,
      quantity,
      unitMicroUsd: tier.micro_usd,
      subtotalMicroUsd,
    });
  }
  return {
    estimatedCostMicroUsd: components.reduce((sum, component) => sum + component.subtotalMicroUsd, 0),
    complete,
    currency: "USD",
    pricingSource: "pika-catalog",
    components,
  };
}

export async function fetchPikaCatalogQuote(options: {
  operation: string;
  input: Record<string, unknown>;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<PikaCatalogQuote> {
  try {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const root = (options.baseUrl?.trim() || PIKA_CATALOG_BASE_URL).replace(/\/+$/, "");
    const response = await fetchImpl(
      `${root}/catalog/apis/${encodeURIComponent(options.operation)}?expand=inputs`,
    );
    if (!response.ok) throw new Error(`Pika catalog returned ${response.status}`);
    const catalog = await response.json() as PikaCatalogEntry;
    return quotePikaCatalogRequest({
      operation: options.operation,
      input: options.input,
      catalog,
    });
  } catch {
    return {
      estimatedCostMicroUsd: undefined,
      complete: false,
      currency: "USD",
      pricingSource: "unavailable",
      components: [],
    };
  }
}
