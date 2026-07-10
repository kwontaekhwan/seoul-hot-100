import { RankingFileSchema, type RankingFile } from './schema';

export async function fetchPrevious(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RankingFile | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const json = await res.json();
    return RankingFileSchema.parse(json);
  } catch {
    return null;
  }
}
