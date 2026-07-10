import { z } from 'zod';
import { CATEGORIES } from './areas';

// --- 서울시 API 응답 ---
export const RawForecastSchema = z.object({
  FCST_TIME: z.string(),
  FCST_CONGEST_LVL: z.string(),
  FCST_PPLTN_MIN: z.string(),
  FCST_PPLTN_MAX: z.string(),
});

export const RawRowSchema = z.object({
  AREA_NM: z.string(),
  AREA_CONGEST_LVL: z.string(),
  AREA_CONGEST_MSG: z.string(),
  AREA_PPLTN_MIN: z.string(),
  AREA_PPLTN_MAX: z.string(),
  MALE_PPLTN_RATE: z.string(),
  FEMALE_PPLTN_RATE: z.string(),
  PPLTN_RATE_0: z.string(),
  PPLTN_RATE_10: z.string(),
  PPLTN_RATE_20: z.string(),
  PPLTN_RATE_30: z.string(),
  PPLTN_RATE_40: z.string(),
  PPLTN_RATE_50: z.string(),
  PPLTN_RATE_60: z.string(),
  PPLTN_RATE_70: z.string(),
  PPLTN_TIME: z.string(),
  FCST_YN: z.string(),
  FCST_PPLTN: z.array(RawForecastSchema).nullable().optional(),
});
export type RawRow = z.infer<typeof RawRowSchema>;

export const CityDataResponseSchema = z.object({
  'SeoulRtd.citydata_ppltn': z.array(RawRowSchema).min(1),
});

// --- 산출물(ranking.json) ---
export const ForecastSchema = z.object({
  time: z.string(),
  congestLevel: z.string(),
  populationMin: z.number(),
  populationMax: z.number(),
});

export const RatesSchema = z.object({
  male: z.number(),
  female: z.number(),
  age: z.record(z.string(), z.number()),
});

export const CollectedAreaSchema = z.object({
  name: z.string(),
  category: z.enum(CATEGORIES),
  congestLevel: z.string(),
  congestMessage: z.string(),
  populationMin: z.number(),
  populationMax: z.number(),
  populationTime: z.string(),
  rates: RatesSchema,
  forecast: z.array(ForecastSchema),
});
export type CollectedArea = z.infer<typeof CollectedAreaSchema>;

export const RankingAreaSchema = CollectedAreaSchema.extend({
  rank: z.number(),
  prevRank: z.number().nullable(),
  stale: z.boolean(),
  staleCount: z.number(),
});
export type RankingArea = z.infer<typeof RankingAreaSchema>;

export const RankingFileSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.string(),
  areas: z.array(RankingAreaSchema),
});
export type RankingFile = z.infer<typeof RankingFileSchema>;
