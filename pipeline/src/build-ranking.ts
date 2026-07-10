import type { CollectedArea, RankingArea, RankingFile } from './schema';

const MAX_STALE = 3;
const SOURCE = '서울 열린데이터광장 실시간 인구데이터 (KT·SKT 통신 신호 기반 추계)';

function compareAreas(a: CollectedArea, b: CollectedArea): number {
  if (b.populationMax !== a.populationMax) return b.populationMax - a.populationMax;
  if (b.populationMin !== a.populationMin) return b.populationMin - a.populationMin;
  return a.name.localeCompare(b.name, 'ko');
}

export interface BuildInput {
  fresh: CollectedArea[];
  failed: string[];
  prev: RankingFile | null;
  generatedAt: string;
}

type Merged = CollectedArea & { stale: boolean; staleCount: number };

export function buildRanking(input: BuildInput): RankingFile {
  const { fresh, failed, prev, generatedAt } = input;
  const prevByName = new Map<string, RankingArea>((prev?.areas ?? []).map((a) => [a.name, a]));

  const merged: Merged[] = fresh.map((a) => ({ ...a, stale: false, staleCount: 0 }));

  for (const name of failed) {
    const prevArea = prevByName.get(name);
    if (!prevArea) continue; // 직전 값 없음 → 이번 랭킹에서 빠짐
    const nextStaleCount = prevArea.staleCount + 1;
    if (nextStaleCount >= MAX_STALE) continue; // 연속 실패 → 제외
    const { rank: _r, prevRank: _p, stale: _s, staleCount: _c, ...carried } = prevArea;
    merged.push({ ...carried, stale: true, staleCount: nextStaleCount });
  }

  const areas: RankingArea[] = [...merged]
    .sort(compareAreas)
    .map((a, i) => ({ ...a, rank: i + 1, prevRank: prevByName.get(a.name)?.rank ?? null }));

  return { version: 1, generatedAt, source: SOURCE, areas };
}
