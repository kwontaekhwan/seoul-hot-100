import { categoryOf } from './areas';
import { parseRow } from './parse';
import { CityDataResponseSchema, type CollectedArea } from './schema';

const DEFAULT_BASE = 'http://openapi.seoul.go.kr:8088';
const TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 500;

export interface CollectOptions {
  apiKey: string;
  baseUrl?: string;
  concurrency?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface CollectResult {
  fresh: CollectedArea[];
  failed: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(BACKOFF_BASE_MS * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function fetchArea(area: string, opts: CollectOptions): Promise<CollectedArea> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const category = categoryOf(area);
  if (!category) throw new Error(`알 수 없는 장소: ${area}`);

  const url = `${base}/${opts.apiKey}/json/citydata_ppltn/1/1/${encodeURIComponent(area)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} (${area})`);
    const json = await res.json();
    const parsed = CityDataResponseSchema.parse(json);
    return parseRow(parsed['SeoulRtd.citydata_ppltn'][0], category);
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function collectAll(areas: string[], opts: CollectOptions): Promise<CollectResult> {
  const concurrency = opts.concurrency ?? 5;
  const retries = opts.retries ?? 2;

  const settled = await mapWithConcurrency(areas, concurrency, async (area) => {
    try {
      const data = await withRetry(() => fetchArea(area, opts), retries);
      return { ok: true as const, area, data };
    } catch {
      return { ok: false as const, area };
    }
  });

  const fresh: CollectedArea[] = [];
  const failed: string[] = [];
  for (const item of settled) {
    if (item.ok) fresh.push(item.data);
    else failed.push(item.area);
  }
  return { fresh, failed };
}
