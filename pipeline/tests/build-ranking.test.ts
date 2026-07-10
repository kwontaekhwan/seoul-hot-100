import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRanking } from '../src/build-ranking';
import { fetchPrevious } from '../src/fetch-prev';
import { RankingFileSchema, type CollectedArea, type RankingFile } from '../src/schema';

function loadPrev(): RankingFile {
  const path = fileURLToPath(new URL('./fixtures/prev-ranking.json', import.meta.url));
  return RankingFileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}

function area(name: string, max: number, min = max - 1000): CollectedArea {
  return {
    name, category: '인구밀집지역', congestLevel: '보통', congestMessage: 'msg',
    populationMin: min, populationMax: max, populationTime: '2026-07-10 09:30',
    rates: { male: 50, female: 50, age: { '0':1,'10':4,'20':22,'30':26,'40':22,'50':14,'60':7,'70':4 } },
    forecast: [],
  };
}

const GEN = '2026-07-10T09:30:00.000+09:00';

describe('buildRanking', () => {
  it('인구 내림차순으로 rank를 부여한다', () => {
    const r = buildRanking({
      fresh: [area('A', 10000), area('B', 30000), area('C', 20000)],
      failed: [], prev: null, generatedAt: GEN,
    });
    expect(r.areas.map((a) => a.name)).toEqual(['B', 'C', 'A']);
    expect(r.areas.map((a) => a.rank)).toEqual([1, 2, 3]);
  });

  it('동률 max는 min, 그다음 이름(ko)으로 정렬한다', () => {
    const r = buildRanking({
      fresh: [area('나', 20000, 5000), area('가', 20000, 5000), area('다', 20000, 9000)],
      failed: [], prev: null, generatedAt: GEN,
    });
    // 다(min 9000) → 가/나(min 5000, 이름순)
    expect(r.areas.map((a) => a.name)).toEqual(['다', '가', '나']);
  });

  it('직전 배포본과 비교해 prevRank를 채운다(신규는 null)', () => {
    const prev = loadPrev();
    const r = buildRanking({
      fresh: [area('강남역', 70000), area('신규역', 50000)],
      failed: [], prev, generatedAt: GEN,
    });
    const gangnam = r.areas.find((a) => a.name === '강남역')!;
    const isNew = r.areas.find((a) => a.name === '신규역')!;
    expect(gangnam.prevRank).toBe(1);
    expect(gangnam.stale).toBe(false);
    expect(gangnam.staleCount).toBe(0);
    expect(isNew.prevRank).toBeNull();
  });

  it('실패 장소는 직전 값을 stale로 유지하고 staleCount를 올린다', () => {
    const prev = loadPrev();
    const r = buildRanking({
      fresh: [area('강남역', 70000)],
      failed: ['보신각'], prev, generatedAt: GEN,
    });
    const bosingak = r.areas.find((a) => a.name === '보신각');
    expect(bosingak).toBeDefined();
    expect(bosingak!.stale).toBe(true);
    expect(bosingak!.staleCount).toBe(2); // prev 1 → 2
    expect(bosingak!.populationMax).toBe(3000); // 직전 값 유지
  });

  it('staleCount가 3에 도달하면 랭킹에서 제외한다', () => {
    const prev = loadPrev();
    const r = buildRanking({
      fresh: [area('강남역', 70000)],
      failed: ['사라질역'], prev, generatedAt: GEN, // prev staleCount 2 → 3 → 제외
    });
    expect(r.areas.find((a) => a.name === '사라질역')).toBeUndefined();
  });

  it('직전 값이 없는 실패 장소는 그냥 빠진다', () => {
    const r = buildRanking({
      fresh: [area('강남역', 70000)],
      failed: ['처음보는역'], prev: null, generatedAt: GEN,
    });
    expect(r.areas.find((a) => a.name === '처음보는역')).toBeUndefined();
  });

  it('산출물은 RankingFileSchema를 만족한다', () => {
    const r = buildRanking({ fresh: [area('강남역', 70000)], failed: [], prev: null, generatedAt: GEN });
    expect(() => RankingFileSchema.parse(r)).not.toThrow();
    expect(r.version).toBe(1);
    expect(r.generatedAt).toBe(GEN);
  });
});

describe('fetchPrevious', () => {
  it('정상 JSON을 RankingFile로 반환한다', async () => {
    const path = fileURLToPath(new URL('./fixtures/prev-ranking.json', import.meta.url));
    const text = readFileSync(path, 'utf-8');
    const fetchImpl = vi.fn(async () => new Response(text, { status: 200 }));
    const prev = await fetchPrevious('http://x/ranking.json', fetchImpl);
    expect(prev?.areas).toHaveLength(3);
  });

  it('404면 null을 반환한다', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    expect(await fetchPrevious('http://x/ranking.json', fetchImpl)).toBeNull();
  });

  it('네트워크 오류면 null을 반환한다', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('네트워크'); });
    expect(await fetchPrevious('http://x/ranking.json', fetchImpl)).toBeNull();
  });
});
