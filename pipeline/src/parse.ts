import type { Category } from './areas';
import type { CollectedArea, RawRow } from './schema';

function toNumber(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`숫자로 변환 불가: "${value}"`);
  return n;
}

export function parseRow(raw: RawRow, category: Category): CollectedArea {
  const forecast =
    raw.FCST_YN === 'Y' && raw.FCST_PPLTN
      ? raw.FCST_PPLTN.map((f) => ({
          time: f.FCST_TIME,
          congestLevel: f.FCST_CONGEST_LVL,
          populationMin: toNumber(f.FCST_PPLTN_MIN),
          populationMax: toNumber(f.FCST_PPLTN_MAX),
        }))
      : [];

  return {
    name: raw.AREA_NM,
    category,
    congestLevel: raw.AREA_CONGEST_LVL,
    congestMessage: raw.AREA_CONGEST_MSG,
    populationMin: toNumber(raw.AREA_PPLTN_MIN),
    populationMax: toNumber(raw.AREA_PPLTN_MAX),
    populationTime: raw.PPLTN_TIME,
    rates: {
      male: toNumber(raw.MALE_PPLTN_RATE),
      female: toNumber(raw.FEMALE_PPLTN_RATE),
      age: {
        '0': toNumber(raw.PPLTN_RATE_0),
        '10': toNumber(raw.PPLTN_RATE_10),
        '20': toNumber(raw.PPLTN_RATE_20),
        '30': toNumber(raw.PPLTN_RATE_30),
        '40': toNumber(raw.PPLTN_RATE_40),
        '50': toNumber(raw.PPLTN_RATE_50),
        '60': toNumber(raw.PPLTN_RATE_60),
        '70': toNumber(raw.PPLTN_RATE_70),
      },
    },
    forecast,
  };
}
