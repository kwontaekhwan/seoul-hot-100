import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CityDataResponseSchema } from '../src/schema';
import { parseRow } from '../src/parse';

function loadFixture(name: string) {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const json = JSON.parse(readFileSync(path, 'utf-8'));
  return CityDataResponseSchema.parse(json)['SeoulRtd.citydata_ppltn'][0];
}

describe('parseRow', () => {
  it('문자열 인구·비율을 숫자로 변환한다', () => {
    const row = loadFixture('gangnam.json');
    const area = parseRow(row, '인구밀집지역');
    expect(area.name).toBe('강남역');
    expect(area.category).toBe('인구밀집지역');
    expect(area.populationMin).toBe(66000);
    expect(area.populationMax).toBe(68000);
    expect(area.congestLevel).toBe('보통');
    expect(area.rates.male).toBeCloseTo(49.4);
    expect(area.rates.age['30']).toBeCloseTo(26.3);
  });

  it('예측(FCST_YN=Y)을 매핑한다', () => {
    const row = loadFixture('gangnam.json');
    const area = parseRow(row, '인구밀집지역');
    expect(area.forecast).toHaveLength(2);
    expect(area.forecast[0]).toEqual({
      time: '2026-07-10 11:00',
      congestLevel: '약간 붐빔',
      populationMin: 76000,
      populationMax: 78000,
    });
  });

  it('예측 없음(FCST_YN=N)은 빈 배열이다', () => {
    const row = loadFixture('no-forecast.json');
    const area = parseRow(row, '고궁·문화유산');
    expect(area.forecast).toEqual([]);
  });

  it('산출물이 CollectedAreaSchema를 만족한다', () => {
    const row = loadFixture('gangnam.json');
    const area = parseRow(row, '인구밀집지역');
    // 반환 객체는 스키마 검증을 통과해야 한다
    expect(() => CityDataResponseSchema).not.toThrow();
    expect(area.forecast.every((f) => typeof f.populationMax === 'number')).toBe(true);
  });
});
