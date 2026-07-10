import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchArea, collectAll } from '../src/collect';

function fixtureText(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf-8');
}

function okResponse(name: string): Response {
  return new Response(fixtureText(name), { status: 200 });
}

describe('fetchArea', () => {
  it('API를 호출해 CollectedArea를 반환한다', async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0]) => okResponse('gangnam.json'));
    const area = await fetchArea('강남역', { apiKey: 'TEST', fetchImpl });
    expect(area.name).toBe('강남역');
    expect(area.populationMax).toBe(68000);
    // URL에 키와 인코딩된 장소명이 포함된다
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain('/TEST/json/citydata_ppltn/1/1/');
    expect(calledUrl).toContain(encodeURIComponent('강남역'));
  });

  it('HTTP 오류 시 throw한다', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    await expect(fetchArea('강남역', { apiKey: 'TEST', fetchImpl })).rejects.toThrow();
  });
});

describe('collectAll', () => {
  it('성공은 fresh, 실패는 failed로 분류한다', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes(encodeURIComponent('강남역'))) return okResponse('gangnam.json');
      return new Response('', { status: 500 });
    });
    const result = await collectAll(['강남역', '보신각'], {
      apiKey: 'TEST',
      fetchImpl,
      retries: 0,
    });
    expect(result.fresh.map((a) => a.name)).toEqual(['강남역']);
    expect(result.failed).toEqual(['보신각']);
  });

  it('실패는 retries 횟수만큼 재시도한다', async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('네트워크');
      return okResponse('gangnam.json');
    });
    const result = await collectAll(['강남역'], { apiKey: 'TEST', fetchImpl, retries: 2 });
    expect(attempts).toBe(3); // 최초 1 + 재시도 2
    expect(result.fresh).toHaveLength(1);
  });

  it('concurrency 옵션으로 동시 요청 수를 제한한다', async () => {
    const areas = ['강남역', '역삼역', '교대역', '사당역', '서울역', '합정역'];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0]) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return okResponse('gangnam.json');
    });

    const result = await collectAll(areas, {
      apiKey: 'TEST',
      fetchImpl,
      concurrency: 2,
      retries: 0,
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(result.fresh).toHaveLength(6);
  });
});
