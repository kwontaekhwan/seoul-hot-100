# 기술 아키텍처 — 서울 핫플 100

- 작성일: 2026-07-09
- 상태: 초안 (v0.1)
- 선행 문서: [PRD.md](./PRD.md)

## 1. 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│ GitHub Actions (cron: 30분 간격, 01~05시 KST 제외)        │
│                                                          │
│  collect.ts ──► 서울시 citydata_ppltn API (119곳 순회)    │
│      │                                                   │
│      ▼                                                   │
│  build-ranking.ts ──► 직전 스냅샷과 diff → 순위 변동 계산  │
│      │                                                   │
│      ▼                                                   │
│  ranking.json ──► GitHub Pages 배포 (무료 CDN, ACAO: *)   │
└─────────────────────────────────────────────────────────┘
                          │ HTTPS GET (1회)
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 토스 앱인토스 미니앱 (Granite React Native)               │
│                                                          │
│  useRanking() ──► HomeScreen (HOT 100 리스트 + 필터)      │
│                └► DetailScreen (혼잡도 상세 + 예측)        │
│  광고: @apps-in-toss/framework InlineAd (배너 3지면)      │
└─────────────────────────────────────────────────────────┘
```

핵심 원칙: **런타임 서버 0대.** 모든 연산은 빌드 타임(Actions)에 끝내고, 앱은 정적 JSON 하나만 읽는다.

## 2. 저장소 구성 (모노레포)

```
seoul-density/
├── docs/                  # 기획·설계 문서 (이 문서 포함)
├── pipeline/              # 데이터 수집·랭킹 생성 (Node.js + TypeScript)
│   ├── src/
│   │   ├── collect.ts     # 서울시 API 순회 수집 (동시성 제한 + 재시도)
│   │   ├── build-ranking.ts # 정렬·순위변동 diff·JSON 생성
│   │   ├── schema.ts      # 응답/산출물 zod 스키마
│   │   └── areas.ts       # 119개 장소명·카테고리 정적 목록
│   └── tests/
├── app/                   # Granite RN 미니앱
│   ├── granite.config.ts
│   └── src/
│       ├── screens/       # HomeScreen, DetailScreen
│       ├── components/    # RankingRow, CongestBadge, CategoryChips, AdSlot ...
│       ├── hooks/         # useRanking
│       └── lib/           # format, congestColor, constants
└── .github/workflows/
    └── update-ranking.yml # cron 수집 + Pages 배포
```

## 3. 데이터 파이프라인

### 3.1 수집 (collect.ts)

- 대상: 서울시 실시간 인구데이터 `citydata_ppltn/1/1/{area}` — 119개 장소
- 경로: **자체 `SEOUL_OPEN_API_KEY` (GitHub Secrets) 로 서울 열린데이터광장 직접 호출** — 할당량 독립, 외부 프록시 의존 없음
  - 엔드포인트: `http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/1/{area}`
  - 키는 환경변수로만 주입, 코드·로그·산출물에 하드코딩 금지
- 동시성 5, 요청당 타임아웃 10초, 실패 시 지수 백오프 2회 재시도
- 부분 실패 허용: 실패한 장소는 직전 스냅샷 값을 유지하고 `stale: true` 마킹, 스냅샷 3회 연속 실패 시 랭킹에서 제외
- 전체 실패(⅓ 이상 실패 등) 시 산출물을 갱신하지 않고 job 을 실패 처리 → 이전 JSON이 그대로 서비스됨 (무중단)

### 3.2 랭킹 생성 (build-ranking.ts)

- 정렬 키: `AREA_PPLTN_MAX` 내림차순 → 동률 시 `AREA_PPLTN_MIN` 내림차순 → 동률 시 장소명 가나다순 (결정적 정렬)
- 직전 배포본 `ranking.json`을 fetch 해 순위 변동 계산: `prevRank - rank` (신규 진입은 `NEW`)
- 119곳 전체를 JSON에 포함하고 `rank`는 1~119 전체에 부여. 앱은 홈에서 100위까지만 노출한다 (카테고리 필터를 적용해도 전체 기준 순위 번호를 유지하기 위해 전체 데이터가 필요)
- zod 스키마 검증 통과 시에만 산출물 생성 (서울시 API 스펙 변경 감지)

### 3.3 산출물 스키마 (ranking.json)

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-09T15:40:00+09:00", // 파이프라인 실행 시각 (KST ISO8601)
  "source": "서울 열린데이터광장 실시간 인구데이터 (KT·SKT 통신 신호 기반 추계)",
  "areas": [
    {
      "rank": 1,
      "prevRank": 3,            // null = NEW
      "name": "강남역",
      "category": "발달상권",    // 관광특구|고궁·문화유산|인구밀집지역|발달상권|공원
      "congestLevel": "붐빔",    // 여유|보통|약간 붐빔|붐빔
      "congestMessage": "사람이 몰려있을 수 있어요",
      "populationMin": 24000,
      "populationMax": 26000,
      "populationTime": "2026-07-09 15:30", // 서울시 데이터 기준 시각
      "stale": false,           // 이번 수집 실패로 직전 값 유지 여부
      "staleCount": 0,          // 연속 수집 실패 횟수 (3 도달 시 랭킹 제외, 성공 시 0으로 리셋)
      "rates": {
        "male": 47.2, "female": 52.8,
        "age": { "0": 0.5, "10": 8.1, "20": 28.4, "30": 22.0, "40": 16.3, "50": 13.2, "60": 7.9, "70": 3.6 }
      },
      "forecast": [             // FCST_YN=N 이면 빈 배열
        { "time": "2026-07-09 16:00", "congestLevel": "붐빔", "populationMin": 24000, "populationMax": 26000 }
      ]
    }
  ]
}
```

- 예상 크기: 119곳 × 예측 12개 ≈ 250~400KB (gzip 후 ~50KB, Pages가 gzip 서빙)

### 3.4 스케줄·배포 (update-ranking.yml)

- cron: `*/30 0-15,20-23 * * *` (UTC) — 01:00~04:59 KST(16~19 UTC) 제외, 30분 간격
- GitHub Actions cron 은 보장 실행이 아님 → 지연은 `generatedAt` 기반 앱 배지로 흡수
- 배포: `actions/deploy-pages` (artifact 방식). 시간당 2회 배포로 Pages soft limit 여유
- 호출량: 실행 20시간/일 × 2회/시 = 40사이클 × 119곳 ≈ **4,760콜/일** — Phase 1에서 발급 키의 실제 일일 할당량 대비 여유 확인
- Secrets: `SEOUL_OPEN_API_KEY` 만 사용. 코드·산출물에 키 노출 금지

## 4. 앱 아키텍처 (Granite RN)

### 4.1 셋업

```sh
npm create granite-app@"^1"        # 프로젝트 생성 (kebab-case 앱 이름)
npm install @apps-in-toss/framework
npx ait init                        # granite.config.ts 생성
npm install @toss/tds-react-native  # TDS 컴포넌트
```

- `granite.config.ts`: `appName`(콘솔 등록명과 동일), `displayName`, `primaryColor`, `icon`
- 로컬 브라우저에서 TDS 미동작 → **샌드박스 앱으로 테스트** (iOS 시뮬레이터/실기기, Android)

### 4.2 화면·모듈

| 모듈 | 책임 | 의존 |
|---|---|---|
| `useRanking` | JSON fetch + 로딩/오류/지연 상태 판정 + 카테고리 필터링 | fetch, ranking.json URL 상수 |
| `HomeScreen` | 랭킹 리스트 + 필터 칩 + pull-to-refresh + 광고 슬롯 | useRanking, RankingRow, AdSlot |
| `DetailScreen` | 혼잡도 상세 + 분포 + 예측 타임라인 + 출처 고지 + 광고 | route params(장소 데이터 전달), AdSlot |
| `CongestBadge` | 혼잡도 4단계 → 색·라벨 매핑 | congestColor 유틸 |
| `AdSlot` | InlineAd 래핑 + 토스앱 버전 가드(5.241.0+) + 로드 실패 시 높이 0 | @apps-in-toss/framework |

- 내비게이션: Granite 기본 라우팅 (화면 2개, Home → Detail push)
- 상태 관리: 라이브러리 없이 훅 1개로 충분 (데이터 원천이 단일 JSON)
- 상세 화면은 리스트에서 받은 데이터를 그대로 사용 — 추가 네트워크 요청 없음

### 4.3 데이터 상태 판정 (useRanking)

```
fetch 실패            → status: "error"   (재시도 버튼)
generatedAt +30분 경과 → status: "stale"   (지연 배지 + 데이터 표시)
현재 KST 01~05시      → status: "night"   (새벽 안내 + 마지막 데이터 표시)
정상                  → status: "ok"
```

### 4.4 광고 연동

- 배너: `InlineAd` 컴포넌트 (RN 전용) — 홈 5위 아래 / 홈 최하단 / 상세 하단
- 사전 조건: 앱인토스 콘솔에서 광고 지면 등록 → `adGroupId` 발급
- 토스앱 버전 < 5.241.0 → AdSlot 이 자체적으로 null 렌더 (빈 화면·레이아웃 깨짐 방지)
- 광고 로드 실패는 조용히 접기 (콘텐츠 경험 우선)

## 5. 보안·운영

- 비밀 키는 GitHub Secrets 단일 관리 (`SEOUL_OPEN_API_KEY`). 앱 번들에는 어떤 키도 포함되지 않음
- 앱 → 데이터 fetch 는 공개 정적 파일이라 인증 불필요. 개인정보 수집 없음 (심사 관점 유리)
- 파이프라인 실패 알림: Actions 실패 시 GitHub 알림 (v2: Slack webhook)
- 출시 후 모니터링: Sentry (앱인토스 공식 가이드 지원), 콘솔 '신고 내역' 확인

## 6. 테스트 전략

| 계층 | 대상 | 도구 |
|---|---|---|
| 단위 | pipeline: 정렬·diff·스키마 검증·부분 실패 처리 | vitest (커버리지 80%+) |
| 단위 | app: useRanking 상태 판정, format/congestColor 유틸 | jest + RTL (RN preset) |
| 통합 | pipeline: 서울시 API mock 응답 → ranking.json 생성 e2e | vitest + fixture |
| 수동 | 앱: 샌드박스 앱에서 TDS·광고·실기기 확인 | 샌드박스 앱 (자동화 불가 영역) |
| 계약 | ranking.json 스키마 — pipeline(생산자)과 app(소비자)이 동일 zod 스키마 공유 | 공용 schema 패키지 |

## 7. 주요 결정 기록 (요약)

| 결정 | 선택 | 기각한 대안 |
|---|---|---|
| 랭킹 기준 | 실시간 추정 인구 순위 | 급상승 순위(히스토리 필요), 한산한 곳 순위 |
| 데이터 수집 | GitHub Actions 정적 생성 | 집계 서버(운영비), 클라이언트 직접 수집(119콜/세션) |
| 플랫폼 | Granite RN + TDS | 웹뷰(네이티브 체감 열세) |
| 수익화 | 배너 광고 (v1) | 보상형+프리미엄(개발 범위 증가), IAP(서버+mTLS 필요) |
| 상세 데이터 | 리스트 JSON에 임베드 | 장소별 JSON 분리(요청 수 증가, 119개 파일 관리) |
