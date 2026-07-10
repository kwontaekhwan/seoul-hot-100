# Phase 1 데이터 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울시 실시간 인구 API로 119개 장소를 30분마다 수집해, 추정 인구 순위·순위 변동을 담은 `ranking.json`을 생성하고 GitHub Pages에 무료 배포한다.

**Architecture:** 런타임 서버 0대. GitHub Actions cron이 `pipeline/`의 Node+TypeScript 스크립트를 실행 → 119곳을 동시성 제한·재시도로 수집 → 직전 배포본과 diff해 순위 변동을 계산 → zod로 검증한 `ranking.json`을 Pages artifact로 배포. 앱은 이 정적 JSON 하나만 fetch한다.

**Tech Stack:** Node.js 20 (native fetch, ESM), TypeScript, zod(경계 검증), vitest(단위·통합 테스트), tsx(Actions에서 TS 직접 실행), GitHub Actions + Pages.

## Global Constraints

모든 태스크에 암묵적으로 적용된다.

- **런타임:** Node.js 20, TypeScript, ESM(`"type": "module"`). 외부 런타임 의존은 `zod`만.
- **비밀 관리:** 서울시 키는 `process.env.SEOUL_OPEN_API_KEY`로만 주입. 코드·테스트·로그·산출물·픽스처에 실제 키를 절대 하드코딩하지 않는다.
- **장소 원천:** 119개 장소·5개 카테고리는 `src/areas.ts`가 유일한 source of truth. 다른 파일에 장소명을 중복 정의하지 않는다.
- **경계 검증:** 외부 데이터(서울시 API 응답, 직전 배포본 JSON)는 사용 전 zod 스키마로 검증한다.
- **결정적 정렬:** `populationMax` 내림차순 → 동률 시 `populationMin` 내림차순 → 동률 시 장소명 한국어 오름차순(`localeCompare(…, 'ko')`).
- **API 엔드포인트:** `http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/1/{area}`. 응답 최상위 키는 `SeoulRtd.citydata_ppltn`(배열).
- **cron:** `*/30 0-15,20-23 * * *` (UTC) — 30분 간격, 01:00~04:59 KST(16~19 UTC) 제외.
- **산출물 스키마:** `docs/architecture.md` §3.3과 정확히 일치(+`staleCount`). `version:1`, KST ISO8601 `generatedAt`.
- **테스트 커버리지:** 로직 계층(`src/**` 중 `main.ts` 제외) 80%+ (lines/functions/branches/statements). TDD: 실패 테스트 → 최소 구현 → 통과.
- **불변성:** 새 객체·배열을 만들어 반환한다. 입력 인자를 제자리 변형하지 않는다(로컬로 만든 배열의 `.sort()`는 허용).
- **작업 디렉터리:** 모든 명령은 리포 루트 기준이며, npm 스크립트는 `pipeline/`에서 실행한다.

---

## File Structure

```
pipeline/
├── package.json            # Task 1
├── tsconfig.json           # Task 1
├── vitest.config.ts        # Task 1
├── src/
│   ├── areas.ts            # Task 1 — CATEGORIES, Category, AREAS, allAreas, categoryOf
│   ├── schema.ts           # Task 2 — zod: 응답 스키마 + 산출물 스키마 + 타입
│   ├── parse.ts            # Task 2 — parseRow: raw 행 → CollectedArea
│   ├── collect.ts          # Task 3 — fetchArea, collectAll(동시성+재시도+부분실패)
│   ├── fetch-prev.ts       # Task 4 — fetchPrevious: 직전 배포본 로드(관용적 실패)
│   ├── build-ranking.ts    # Task 4 — buildRanking: 정렬·순위·diff·stale 병합
│   ├── util.ts             # Task 5 — nowKstIso, exceedsFailureThreshold
│   └── main.ts             # Task 5 — 오케스트레이션 CLI(수집→로드→빌드→기록)
└── tests/
    ├── fixtures/
    │   ├── gangnam.json         # Task 2 — 실제 API 응답(예측 있음)
    │   ├── no-forecast.json     # Task 2 — FCST_YN=N 응답
    │   └── prev-ranking.json    # Task 4 — 직전 배포본 샘플
    ├── areas.test.ts        # Task 1
    ├── parse.test.ts        # Task 2
    ├── collect.test.ts      # Task 3
    ├── build-ranking.test.ts# Task 4
    └── util.test.ts         # Task 5
.github/workflows/
    └── update-ranking.yml   # Task 6
pipeline/README.md           # Task 6
```

---

## Task 1: 프로젝트 스캐폴딩 + 장소 데이터

**Files:**
- Create: `pipeline/package.json`, `pipeline/tsconfig.json`, `pipeline/vitest.config.ts`
- Create: `pipeline/src/areas.ts`
- Test: `pipeline/tests/areas.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES: readonly ['고궁·문화유산','관광특구','공원','발달상권','인구밀집지역']`
  - `type Category = (typeof CATEGORIES)[number]`
  - `AREAS: Record<Category, string[]>`
  - `allAreas(): string[]` — 전체 119개 장소명(중복 없음)
  - `categoryOf(area: string): Category | undefined`

- [ ] **Step 1: `pipeline/package.json` 작성**

```json
{
  "name": "seoul-hot-100-pipeline",
  "private": true,
  "type": "module",
  "scripts": {
    "build:ranking": "tsx src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.5",
    "@vitest/coverage-v8": "^2.0.5"
  }
}
```

- [ ] **Step 2: `pipeline/tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: `pipeline/vitest.config.ts` 작성**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
```

- [ ] **Step 4: 의존성 설치**

Run: `cd pipeline && npm install`
Expected: `node_modules/` 생성, 에러 없음.

- [ ] **Step 5: 실패 테스트 작성 — `pipeline/tests/areas.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { AREAS, CATEGORIES, allAreas, categoryOf } from '../src/areas';

describe('areas', () => {
  it('전체 119개 장소를 가진다', () => {
    expect(allAreas()).toHaveLength(119);
  });

  it('장소명에 중복이 없다', () => {
    const names = allAreas();
    expect(new Set(names).size).toBe(names.length);
  });

  it('5개 카테고리를 가진다', () => {
    expect(CATEGORIES).toHaveLength(5);
    expect(Object.keys(AREAS)).toEqual([...CATEGORIES]);
  });

  it('categoryOf는 장소의 카테고리를 반환한다', () => {
    expect(categoryOf('강남역')).toBe('인구밀집지역');
    expect(categoryOf('경복궁')).toBe('고궁·문화유산');
    expect(categoryOf('여의도한강공원')).toBe('공원');
  });

  it('categoryOf는 미지원 장소에 undefined를 반환한다', () => {
    expect(categoryOf('없는장소')).toBeUndefined();
  });
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `cd pipeline && npx vitest run tests/areas.test.ts`
Expected: FAIL — `Cannot find module '../src/areas'`.

- [ ] **Step 7: `pipeline/src/areas.ts` 작성**

주의: 아래 `AREAS`는 서울시 실시간 인구 API의 2026-07 스냅샷(119곳)이다. 장소명은 API `AREA_NM`과 정확히 일치해야 한다(공백·중점 `·`·괄호 포함).

```ts
export const CATEGORIES = [
  '고궁·문화유산',
  '관광특구',
  '공원',
  '발달상권',
  '인구밀집지역',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const AREAS: Record<Category, string[]> = {
  '고궁·문화유산': ['경복궁', '광화문·덕수궁', '보신각', '서울 암사동 유적', '창덕궁·종묘'],
  '관광특구': ['강남 MICE 관광특구', '동대문 관광특구', '명동 관광특구', '이태원 관광특구', '잠실 관광특구', '종로·청계 관광특구', '홍대 관광특구'],
  '공원': ['강서한강공원', '고척돔', '광나루한강공원', '광화문광장', '국립중앙박물관·용산가족공원', '난지한강공원', '남산공원', '노들섬', '뚝섬한강공원', '망원한강공원', '반포한강공원', '보라매공원', '북서울꿈의숲', '서대문독립공원', '서리풀공원·몽마르뜨공원', '서울대공원', '서울숲공원', '송현녹지광장', '아차산', '안양천', '양화한강공원', '어린이대공원', '여의도한강공원', '여의서로', '올림픽공원', '월드컵공원', '응봉산', '이촌한강공원', '잠실종합운동장', '잠실한강공원', '잠원한강공원', '청계산', '홍제폭포'],
  '발달상권': ['가락시장', '가로수길', '광장(전통)시장', '김포공항', '남대문시장', '노량진', '덕수궁길·정동길', '북창동 먹자골목', '북촌한옥마을', '서촌', '성수카페거리', '송리단길·호수단길', '신촌 스타광장', '압구정로데오거리', '여의도', '연남동', '영등포 타임스퀘어', '용리단길', '이태원 앤틱가구거리', '익선동', '인사동', '잠실롯데타워·석촌호수', '창동 신경제 중심지', '청담동 명품거리', '청량리 제기동 일대 전통시장', '해방촌·경리단길', 'DDP(동대문디자인플라자)', 'DMC(디지털미디어시티)'],
  '인구밀집지역': ['가산디지털단지역', '강남역', '건대입구역', '고덕역', '고속터미널역', '교대역', '구로디지털단지역', '구로역', '군자역', '대림역', '동대문역', '뚝섬역', '미아사거리역', '발산역', '사당역', '삼각지역', '서울대입구역', '서울식물원·마곡나루역', '서울역', '성신여대입구역', '선릉역', '시의회 앞', '수유역', '신논현역·논현역', '신도림역', '신림역', '신촌·이대역', '쌍문역', '신정네거리역', '역삼역', '연신내역', '양재역', '왕십리역', '용산역', '오목교역·목동운동장', '잠실새내역', '잠실역', '장지역', '장한평역', '천호역', '총신대입구(이수)역', '충정로역', '합정역', '혜화역', '홍대입구역(2호선)', '회기역'],
};

const AREA_TO_CATEGORY = new Map<string, Category>(
  (Object.entries(AREAS) as [Category, string[]][]).flatMap(([category, names]) =>
    names.map((name) => [name, category] as const),
  ),
);

export function allAreas(): string[] {
  return Object.values(AREAS).flat();
}

export function categoryOf(area: string): Category | undefined {
  return AREA_TO_CATEGORY.get(area);
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `cd pipeline && npx vitest run tests/areas.test.ts`
Expected: PASS (5 tests). 만약 119가 아니면 `AREAS` 항목 수를 세어 스냅샷을 재확인한다.

- [ ] **Step 9: 커밋**

```bash
git add pipeline/package.json pipeline/tsconfig.json pipeline/vitest.config.ts pipeline/src/areas.ts pipeline/tests/areas.test.ts pipeline/package-lock.json
git commit -m "feat(pipeline): 프로젝트 스캐폴딩 + 119개 장소 데이터"
```

---

## Task 2: 스키마 + 파싱

**Files:**
- Create: `pipeline/src/schema.ts`, `pipeline/src/parse.ts`
- Create: `pipeline/tests/fixtures/gangnam.json`, `pipeline/tests/fixtures/no-forecast.json`
- Test: `pipeline/tests/parse.test.ts`

**Interfaces:**
- Consumes: `Category`, `CATEGORIES` from `./areas`
- Produces (schema.ts):
  - `CityDataResponseSchema` (zod) — 서울시 응답 검증, `RawRow` 타입
  - `CollectedAreaSchema`, `type CollectedArea` — 순위 부여 전 장소 데이터
  - `RankingAreaSchema`, `type RankingArea` — `CollectedArea` + `rank, prevRank, stale, staleCount`
  - `RankingFileSchema`, `type RankingFile` — 최종 산출물
- Produces (parse.ts): `parseRow(raw: RawRow, category: Category): CollectedArea`

- [ ] **Step 1: 픽스처 `pipeline/tests/fixtures/gangnam.json` 작성**

실제 API 응답(강남역, 예측 있음). 필드 수는 트림했으나 스키마가 쓰는 필드는 모두 포함.

```json
{
  "SeoulRtd.citydata_ppltn": [
    {
      "AREA_NM": "강남역",
      "AREA_CONGEST_LVL": "보통",
      "AREA_CONGEST_MSG": "사람이 몰려있을 수 있지만 크게 붐비지는 않아요. 도보 이동에 큰 제약이 없어요.",
      "AREA_PPLTN_MIN": "66000",
      "AREA_PPLTN_MAX": "68000",
      "MALE_PPLTN_RATE": "49.4",
      "FEMALE_PPLTN_RATE": "50.6",
      "PPLTN_RATE_0": "1.0",
      "PPLTN_RATE_10": "3.6",
      "PPLTN_RATE_20": "22.2",
      "PPLTN_RATE_30": "26.3",
      "PPLTN_RATE_40": "21.9",
      "PPLTN_RATE_50": "14.4",
      "PPLTN_RATE_60": "6.5",
      "PPLTN_RATE_70": "4.1",
      "PPLTN_TIME": "2026-07-10 09:30",
      "FCST_YN": "Y",
      "FCST_PPLTN": [
        { "FCST_TIME": "2026-07-10 11:00", "FCST_CONGEST_LVL": "약간 붐빔", "FCST_PPLTN_MIN": "76000", "FCST_PPLTN_MAX": "78000" },
        { "FCST_TIME": "2026-07-10 12:00", "FCST_CONGEST_LVL": "붐빔", "FCST_PPLTN_MIN": "84000", "FCST_PPLTN_MAX": "86000" }
      ]
    }
  ]
}
```

- [ ] **Step 2: 픽스처 `pipeline/tests/fixtures/no-forecast.json` 작성**

`FCST_YN=N` + `FCST_PPLTN=null` 케이스.

```json
{
  "SeoulRtd.citydata_ppltn": [
    {
      "AREA_NM": "보신각",
      "AREA_CONGEST_LVL": "여유",
      "AREA_CONGEST_MSG": "사람이 몰리지 않아 여유로워요.",
      "AREA_PPLTN_MIN": "2000",
      "AREA_PPLTN_MAX": "3000",
      "MALE_PPLTN_RATE": "55.0",
      "FEMALE_PPLTN_RATE": "45.0",
      "PPLTN_RATE_0": "0.5",
      "PPLTN_RATE_10": "2.0",
      "PPLTN_RATE_20": "18.0",
      "PPLTN_RATE_30": "20.0",
      "PPLTN_RATE_40": "22.0",
      "PPLTN_RATE_50": "18.5",
      "PPLTN_RATE_60": "12.0",
      "PPLTN_RATE_70": "7.0",
      "PPLTN_TIME": "2026-07-10 09:30",
      "FCST_YN": "N",
      "FCST_PPLTN": null
    }
  ]
}
```

- [ ] **Step 3: 실패 테스트 작성 — `pipeline/tests/parse.test.ts`**

```ts
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
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd pipeline && npx vitest run tests/parse.test.ts`
Expected: FAIL — `Cannot find module '../src/schema'`.

- [ ] **Step 5: `pipeline/src/schema.ts` 작성**

```ts
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
```

- [ ] **Step 6: `pipeline/src/parse.ts` 작성**

```ts
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
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd pipeline && npx vitest run tests/parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: 커밋**

```bash
git add pipeline/src/schema.ts pipeline/src/parse.ts pipeline/tests/parse.test.ts pipeline/tests/fixtures/gangnam.json pipeline/tests/fixtures/no-forecast.json
git commit -m "feat(pipeline): 서울시 응답/산출물 zod 스키마 + 행 파싱"
```

---

## Task 3: 수집기 (동시성 + 재시도 + 부분 실패)

**Files:**
- Create: `pipeline/src/collect.ts`
- Test: `pipeline/tests/collect.test.ts`

**Interfaces:**
- Consumes: `categoryOf` from `./areas`, `CityDataResponseSchema` from `./schema`, `parseRow` from `./parse`, `CollectedArea` type from `./schema`
- Produces:
  - `interface CollectOptions { apiKey: string; baseUrl?: string; concurrency?: number; retries?: number; fetchImpl?: typeof fetch }`
  - `interface CollectResult { fresh: CollectedArea[]; failed: string[] }`
  - `fetchArea(area: string, opts: CollectOptions): Promise<CollectedArea>` — 1개 장소 조회·검증·파싱(실패 시 throw)
  - `collectAll(areas: string[], opts: CollectOptions): Promise<CollectResult>` — 부분 실패 허용

- [ ] **Step 1: 실패 테스트 작성 — `pipeline/tests/collect.test.ts`**

```ts
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
    const fetchImpl = vi.fn(async () => okResponse('gangnam.json'));
    const area = await fetchArea('강남역', { apiKey: 'TEST', fetchImpl });
    expect(area.name).toBe('강남역');
    expect(area.populationMax).toBe(68000);
    // URL에 키와 인코딩된 장소명이 포함된다
    const calledUrl = fetchImpl.mock.calls[0][0] as string;
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
    const fetchImpl = vi.fn(async (url: string) => {
      if ((url as string).includes(encodeURIComponent('강남역'))) return okResponse('gangnam.json');
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
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd pipeline && npx vitest run tests/collect.test.ts`
Expected: FAIL — `Cannot find module '../src/collect'`.

- [ ] **Step 3: `pipeline/src/collect.ts` 작성**

주의 1: 재시도 백오프는 실제 대기가 있으면 테스트가 느려지므로 `retries: 0`/작은 값으로 테스트한다. 백오프 base는 500ms.

주의 2: 이 코드는 응답 최상위가 `{ "SeoulRtd.citydata_ppltn": [ …행… ] }` 형태라고 가정한다(프록시 응답·`seoul-density.md` 예시로 확인). zod가 알 수 없는 키(RESULT, AREA_CD 등)는 자동으로 무시하므로 실제 전체 응답도 통과한다. 직접 엔드포인트(`openapi.seoul.go.kr:8088`)의 최상위 형태가 다를 가능성은 Task 6 Step 4 실키 스모크에서 최종 확인한다. 만약 형태가 다르면 이 파일의 추출부(`parsed['SeoulRtd.citydata_ppltn'][0]`)만 조정한다.

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd pipeline && npx vitest run tests/collect.test.ts`
Expected: PASS (4 tests). 재시도 테스트는 백오프(0.5s+1s) 때문에 ~1.5s 소요될 수 있다.

- [ ] **Step 5: 커밋**

```bash
git add pipeline/src/collect.ts pipeline/tests/collect.test.ts
git commit -m "feat(pipeline): 동시성·재시도·부분실패 허용 수집기"
```

---

## Task 4: 직전 스냅샷 로드 + 랭킹 빌드

**Files:**
- Create: `pipeline/src/fetch-prev.ts`, `pipeline/src/build-ranking.ts`
- Create: `pipeline/tests/fixtures/prev-ranking.json`
- Test: `pipeline/tests/build-ranking.test.ts`

**Interfaces:**
- Consumes: `CollectedArea`, `RankingArea`, `RankingFile`, `RankingFileSchema` from `./schema`
- Produces:
  - `fetchPrevious(url: string, fetchImpl?: typeof fetch): Promise<RankingFile | null>` — 실패·404·스키마 불일치 시 `null`
  - `interface BuildInput { fresh: CollectedArea[]; failed: string[]; prev: RankingFile | null; generatedAt: string }`
  - `buildRanking(input: BuildInput): RankingFile`
- 규칙: 정렬은 Global Constraints의 결정적 정렬. 실패 장소는 직전 값 유지 + `stale:true` + `staleCount+1`, `staleCount>=3`이면 제외. `prevRank`는 직전 배포본에서의 `rank`(없으면 `null`=NEW). 신선 수집은 `staleCount:0, stale:false`.

- [ ] **Step 1: 픽스처 `pipeline/tests/fixtures/prev-ranking.json` 작성**

강남역(1위)·보신각(2위, staleCount 2)·사라질역(3위, staleCount 2) 3곳으로 diff·stale 경계를 검증.

```json
{
  "version": 1,
  "generatedAt": "2026-07-10T09:00:00.000+09:00",
  "source": "서울 열린데이터광장 실시간 인구데이터 (KT·SKT 통신 신호 기반 추계)",
  "areas": [
    {
      "rank": 1, "prevRank": 1, "name": "강남역", "category": "인구밀집지역",
      "congestLevel": "보통", "congestMessage": "보통이에요",
      "populationMin": 60000, "populationMax": 62000, "populationTime": "2026-07-10 08:30",
      "stale": false, "staleCount": 0,
      "rates": { "male": 50, "female": 50, "age": { "0":1,"10":4,"20":22,"30":26,"40":22,"50":14,"60":7,"70":4 } },
      "forecast": []
    },
    {
      "rank": 2, "prevRank": 2, "name": "보신각", "category": "고궁·문화유산",
      "congestLevel": "여유", "congestMessage": "여유로워요",
      "populationMin": 2000, "populationMax": 3000, "populationTime": "2026-07-10 08:30",
      "stale": true, "staleCount": 1,
      "rates": { "male": 55, "female": 45, "age": { "0":0,"10":2,"20":18,"30":20,"40":22,"50":18,"60":12,"70":8 } },
      "forecast": []
    },
    {
      "rank": 3, "prevRank": 3, "name": "사라질역", "category": "인구밀집지역",
      "congestLevel": "여유", "congestMessage": "여유로워요",
      "populationMin": 1000, "populationMax": 1500, "populationTime": "2026-07-10 08:30",
      "stale": true, "staleCount": 2,
      "rates": { "male": 50, "female": 50, "age": { "0":0,"10":2,"20":18,"30":20,"40":22,"50":18,"60":12,"70":8 } },
      "forecast": []
    }
  ]
}
```

- [ ] **Step 2: 실패 테스트 작성 — `pipeline/tests/build-ranking.test.ts`**

```ts
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
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd pipeline && npx vitest run tests/build-ranking.test.ts`
Expected: FAIL — `Cannot find module '../src/build-ranking'`.

- [ ] **Step 4: `pipeline/src/fetch-prev.ts` 작성**

```ts
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
```

- [ ] **Step 5: `pipeline/src/build-ranking.ts` 작성**

```ts
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
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd pipeline && npx vitest run tests/build-ranking.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: 커밋**

```bash
git add pipeline/src/fetch-prev.ts pipeline/src/build-ranking.ts pipeline/tests/build-ranking.test.ts pipeline/tests/fixtures/prev-ranking.json
git commit -m "feat(pipeline): 직전 스냅샷 로드 + 정렬·순위변동·stale 병합 랭킹 빌드"
```

---

## Task 5: 유틸 + 오케스트레이션 CLI

**Files:**
- Create: `pipeline/src/util.ts`, `pipeline/src/main.ts`
- Test: `pipeline/tests/util.test.ts`

**Interfaces:**
- Consumes: `allAreas`(areas), `collectAll`(collect), `fetchPrevious`(fetch-prev), `buildRanking`(build-ranking), `RankingFileSchema`(schema)
- Produces (util.ts):
  - `nowKstIso(now?: Date): string` — KST(UTC+9) ISO8601, 예: `2026-07-10T15:40:00.000+09:00`
  - `exceedsFailureThreshold(failedCount: number, total: number, ratio?: number): boolean` — 기본 임계 1/3
- Produces (main.ts): 실행 스크립트. env `SEOUL_OPEN_API_KEY`(필수), `RANKING_URL`(선택, 직전 배포본). `dist/ranking.json` 기록. 실패율 초과 시 비정상 종료(산출물 미기록).

- [ ] **Step 1: 실패 테스트 작성 — `pipeline/tests/util.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { nowKstIso, exceedsFailureThreshold } from '../src/util';

describe('nowKstIso', () => {
  it('UTC를 KST(+09:00) ISO로 변환한다', () => {
    // 2026-07-10T06:40:00Z → KST 15:40
    const iso = nowKstIso(new Date('2026-07-10T06:40:00.000Z'));
    expect(iso).toBe('2026-07-10T15:40:00.000+09:00');
  });

  it('자정 경계를 넘겨 날짜를 올린다', () => {
    // 2026-07-10T20:00:00Z → KST 다음날 05:00
    const iso = nowKstIso(new Date('2026-07-10T20:00:00.000Z'));
    expect(iso).toBe('2026-07-11T05:00:00.000+09:00');
  });
});

describe('exceedsFailureThreshold', () => {
  it('1/3 초과면 true', () => {
    expect(exceedsFailureThreshold(40, 119)).toBe(true); // 40/119 ≈ 33.6%
  });
  it('1/3 이하면 false', () => {
    expect(exceedsFailureThreshold(39, 119)).toBe(false); // 39/119 ≈ 32.8%
    expect(exceedsFailureThreshold(0, 119)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd pipeline && npx vitest run tests/util.test.ts`
Expected: FAIL — `Cannot find module '../src/util'`.

- [ ] **Step 3: `pipeline/src/util.ts` 작성**

`nowKstIso`는 UTC 시각에 +9시간을 더한 뒤 `toISOString()`의 `Z`를 `+09:00`으로 치환한다(KST는 DST 없음).

```ts
export function nowKstIso(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('Z', '+09:00');
}

export function exceedsFailureThreshold(
  failedCount: number,
  total: number,
  ratio = 1 / 3,
): boolean {
  if (total === 0) return false;
  return failedCount / total > ratio;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd pipeline && npx vitest run tests/util.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: `pipeline/src/main.ts` 작성**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { allAreas } from './areas';
import { collectAll } from './collect';
import { fetchPrevious } from './fetch-prev';
import { buildRanking } from './build-ranking';
import { RankingFileSchema } from './schema';
import { nowKstIso, exceedsFailureThreshold } from './util';

const OUTPUT_PATH = 'dist/ranking.json';

async function run(): Promise<void> {
  const apiKey = process.env.SEOUL_OPEN_API_KEY;
  if (!apiKey) throw new Error('SEOUL_OPEN_API_KEY 환경변수가 필요합니다.');
  const prevUrl = process.env.RANKING_URL;

  const areas = allAreas();
  const { fresh, failed } = await collectAll(areas, { apiKey });
  console.log(`수집 완료: 성공 ${fresh.length} / 실패 ${failed.length} / 전체 ${areas.length}`);

  if (exceedsFailureThreshold(failed.length, areas.length)) {
    throw new Error(`실패율이 1/3을 초과했습니다(실패 ${failed.length}). 산출물을 갱신하지 않습니다.`);
  }

  const prev = prevUrl ? await fetchPrevious(prevUrl) : null;
  if (prevUrl && !prev) console.warn(`직전 배포본을 불러오지 못했습니다: ${prevUrl} (최초 실행이면 정상)`);

  const ranking = buildRanking({ fresh, failed, prev, generatedAt: nowKstIso() });
  RankingFileSchema.parse(ranking); // 산출물 자체 검증

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(ranking), 'utf-8');
  console.log(`${OUTPUT_PATH} 생성 완료 (${ranking.areas.length}곳, ${ranking.generatedAt})`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 6: 키 없이 실행하면 즉시 실패하는지 확인(안전장치)**

Run: `cd pipeline && npx tsx src/main.ts`
Expected: `SEOUL_OPEN_API_KEY 환경변수가 필요합니다.` 출력 + 종료코드 1. (실제 수집은 Task 6의 Actions/로컬 키로 검증)

- [ ] **Step 7: 전체 테스트 + 타입체크 + 커버리지 확인**

Run: `cd pipeline && npx vitest run --coverage && npm run typecheck`
Expected: 전체 PASS, 커버리지 80%+ (main.ts 제외), 타입 에러 0.

- [ ] **Step 8: 커밋**

```bash
git add pipeline/src/util.ts pipeline/src/main.ts pipeline/tests/util.test.ts
git commit -m "feat(pipeline): KST 시각·실패율 유틸 + 오케스트레이션 CLI"
```

---

## Task 6: GitHub Actions 워크플로 + Pages 배포

**Files:**
- Create: `.github/workflows/update-ranking.yml`
- Create: `pipeline/README.md`
- Create: `pipeline/.gitignore`

**Interfaces:**
- Consumes: `npm run build:ranking`(package.json), env `SEOUL_OPEN_API_KEY`(secret), `RANKING_URL`
- Produces: 30분마다 `https://<owner>.github.io/<repo>/ranking.json` 갱신

- [ ] **Step 1: `pipeline/.gitignore` 작성**

```
node_modules/
dist/
coverage/
```

- [ ] **Step 2: `.github/workflows/update-ranking.yml` 작성**

```yaml
name: Update ranking

on:
  schedule:
    - cron: '*/30 0-15,20-23 * * *' # 30분 간격, 01~05 KST(16~19 UTC) 제외
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: pipeline/package-lock.json

      - name: Install dependencies
        working-directory: pipeline
        run: npm ci

      - name: Build ranking.json
        working-directory: pipeline
        env:
          SEOUL_OPEN_API_KEY: ${{ secrets.SEOUL_OPEN_API_KEY }}
          RANKING_URL: https://${{ github.repository_owner }}.github.io/${{ github.event.repository.name }}/ranking.json
        run: npm run build:ranking

      - name: Assemble Pages site
        run: |
          mkdir -p _site
          cp pipeline/dist/ranking.json _site/ranking.json

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: _site

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: `pipeline/README.md` 작성**

````markdown
# seoul-hot-100 pipeline

서울시 실시간 인구 API로 119개 장소를 수집해 `ranking.json`을 생성한다.

## 로컬 실행

```bash
cd pipeline
npm install
SEOUL_OPEN_API_KEY=발급받은키 npm run build:ranking
# → dist/ranking.json 생성
```

직전 배포본과 순위 변동을 비교하려면(선택):

```bash
SEOUL_OPEN_API_KEY=키 RANKING_URL=https://<owner>.github.io/<repo>/ranking.json npm run build:ranking
```

## 테스트

```bash
npm run test          # vitest
npm run test -- --coverage
npm run typecheck
```

## 배포 (GitHub Actions)

- `.github/workflows/update-ranking.yml`가 30분마다(01~05 KST 제외) 실행된다.
- 필요 설정:
  1. 저장소 **Settings → Secrets and variables → Actions**에 `SEOUL_OPEN_API_KEY` 등록.
  2. **Settings → Pages → Build and deployment → Source: GitHub Actions** 선택.
  3. 최초 1회는 **Actions 탭 → Update ranking → Run workflow**로 수동 실행.
- 산출물 URL: `https://<owner>.github.io/<repo>/ranking.json`
````

- [ ] **Step 4: 로컬 스모크 테스트(실제 키로 검증)**

발급받은 서울시 키로 실제 수집이 도는지 확인한다. 키는 셸 히스토리에 남지 않도록 주의하고 커밋하지 않는다.

Run:
```bash
cd pipeline && SEOUL_OPEN_API_KEY='발급받은키' npm run build:ranking
```
Expected: `수집 완료: 성공 N / 실패 M ...` 후 `dist/ranking.json 생성 완료 (N곳 ...)`. 새벽 01~05시(KST)에는 서울시 데이터가 비어 실패율이 높을 수 있으니 낮 시간대에 검증한다.

- [ ] **Step 5: 산출물 형태 검증**

Run:
```bash
cd pipeline && node -e "const r=require('./dist/ranking.json'); console.log('areas:', r.areas.length, '| top1:', r.areas[0].name, r.areas[0].populationMax, '| generatedAt:', r.generatedAt)"
```
Expected: `areas`가 100 이상, `top1`에 인구가 가장 많은 장소, `generatedAt`이 `+09:00`으로 끝남.

- [ ] **Step 6: 커밋 + 푸시**

```bash
git add .github/workflows/update-ranking.yml pipeline/README.md pipeline/.gitignore
git commit -m "ci(pipeline): 30분 주기 수집 + GitHub Pages 배포 워크플로"
git push -u origin master
```

- [ ] **Step 7: 리포지토리 설정 + 첫 배포 (수동 확인)**

README §배포의 3단계를 콘솔에서 수행:
1. `SEOUL_OPEN_API_KEY` Secret 등록
2. Pages Source를 "GitHub Actions"로 설정
3. Actions에서 워크플로 수동 실행 → 성공 후 `https://<owner>.github.io/<repo>/ranking.json` 접속 확인

Expected: 브라우저에서 JSON이 열리고, 응답 헤더에 `access-control-allow-origin: *`(GitHub Pages 기본)이 있어 앱 origin 요건을 충족한다.

---

## 완료 기준 (Phase 1 DoD)

- [ ] 공개 URL에서 `ranking.json`이 30분(±cron 지연) 주기로 갱신된다.
- [ ] 로직 계층(`main.ts` 제외) 테스트 커버리지 80%+.
- [ ] 24시간 시운전 후 갱신 성공률 95%+ (roadmap.md Phase 1 DoD). 시운전은 배포 다음 날 Actions 실행 이력으로 확인한다.

## 다음 단계

Phase 2(앱 MVP)는 이 `ranking.json`을 소비한다. `src/schema.ts`의 산출물 스키마(`RankingFileSchema`, `RankingArea`)를 앱과 공유하거나 복제해 생산자/소비자 계약을 맞춘다(architecture.md §6 계약 테스트).
