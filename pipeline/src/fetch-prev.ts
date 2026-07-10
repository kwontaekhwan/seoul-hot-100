import { RankingFileSchema, type RankingFile } from './schema';

const PREV_TIMEOUT_MS = 10_000;

export async function fetchPrevious(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RankingFile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREV_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return RankingFileSchema.parse(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
