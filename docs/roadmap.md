# 로드맵 · 단계별 검토 체크리스트 — 서울 핫플 100

- 작성일: 2026-07-09
- 상태: 초안 (v0.1)
- 선행 문서: [PRD.md](./PRD.md), [architecture.md](./architecture.md), [design-guide.md](./design-guide.md)

각 Phase 는 완료 기준(Definition of Done)을 만족해야 다음 단계로 진행한다.

## Phase 0 — 기획·설계 (현재)

- [x] 랭킹 기준·MVP 범위·수집 방식·플랫폼·수익화 결정
- [x] PRD / 아키텍처 / 디자인 가이드 / 로드맵 문서 작성
- [x] 서비스명(**서울 핫플 100**)·갱신 주기(**30분**)·수집 경로(**자체 API 키**) 확정
- [ ] 사용자 문서 리뷰·승인

**DoD**: 문서 4종 승인 완료.

## Phase 1 — 데이터 파이프라인 ✅ 배포 완료 (2026-07-10)

- [x] 서울시 열린데이터광장 API 키 발급 + 할당량 여유 확인 (119/119 수집 성공, 30분 주기 약 4,760콜/일로 여유)
- [x] `pipeline/` 구현 (TDD): areas 목록 → collect → build-ranking → ranking.json
  - [x] 정렬·순위변동 diff 단위 테스트
  - [x] 부분 실패·전체 실패 처리 테스트
  - [x] zod 스키마 검증 (API 응답 + 산출물)
- [x] GitHub Actions workflow: cron `*/30 0-15,20-23 * * *` + Pages 배포
- [x] 라이브 배포: `https://kwontaekhwan.github.io/seoul-hot-100/ranking.json` (HTTP 200, ACAO `*`, 119곳)
- [ ] 24시간 시운전: 갱신 성공률·지연 측정, 새벽 시간대 동작 확인 (첫 cron 실행 대기 중)

**DoD**: 공개 URL에서 ranking.json 이 30분(±지연) 주기로 갱신되고, 24시간 시운전 성공률 95%+.
→ 공개 URL 서빙·수동 실행 성공 확인. 24시간 시운전(자동 cron 성공률)만 관찰 남음.

**리포:** github.com/kwontaekhwan/seoul-hot-100 (public). Secret `SEOUL_OPEN_API_KEY` 등록됨, Pages Source=Actions.

**후속(비긴급):** Actions 로그에 Node 20 deprecation 경고 — action 래퍼 런타임 관련(빌드 자체는 정상). 향후 `actions/*` 메이저 버전 상향 시 해소.

## Phase 2 — 앱 MVP

- [ ] 사전 준비
  - [ ] 앱인토스 콘솔 워크스페이스·앱 등록 (appName `seoul-hot-100`)
  - [ ] 사업자 등록 정보 콘솔 제출 (수익화 정산 요건)
- [ ] Granite 프로젝트 셋업 (`create granite-app` → `ait init` → TDS 설치)
- [ ] 구현 (TDD — 로직 계층)
  - [ ] `useRanking` 훅: fetch + ok/error/stale/night 상태 판정 테스트
  - [ ] format(인구 표기)·congestColor 유틸 테스트
  - [ ] HomeScreen: 리스트 + 카테고리 필터 + pull-to-refresh
  - [ ] DetailScreen: 혼잡도 + 분포 + 예측 타임라인 + 출처 고지
  - [ ] 상태 화면 4종 (로딩/오류/지연/새벽)
- [ ] 샌드박스 앱에서 iOS·Android 실기기 확인 (TDS 는 로컬 브라우저 미동작)

**DoD**: 샌드박스에서 홈→상세 전 플로우 + 상태 화면 4종 동작, 로직 테스트 커버리지 80%+.

## Phase 3 — 광고 연동 + 출시

- [ ] 콘솔에서 광고 지면 3개 등록 → `adGroupId` 발급
- [ ] `AdSlot` 구현: InlineAd + 토스앱 5.241.0 버전 가드 + 로드 실패 시 접기
- [ ] 출시 전 검수 체크리스트 (앱인토스 공식)
  - [ ] **비게임 출시 가이드**(checklist/app-nongame) 전 항목 점검
  - [ ] 번들 압축 해제 100MB 이하 확인 (대용량 리소스는 CDN 분리)
  - [ ] CORS: 정적 호스트가 `https://<appName>.apps.tossmini.com` / `https://<appName>.private-apps.tossmini.com` origin 에서 접근 가능한지 실환경 확인
  - [ ] 공공데이터 출처·추계치 고지 문구 노출 확인
  - [ ] 콘솔 테스트 1회 이상 완료 (검토 요청 버튼 활성화 조건)
- [ ] 검토 요청 (영업일 최대 3일) → 반려 시 사유 수정 후 재요청
- [ ] 출시 (즉시 전체 반영 — 최종 테스트 후 실행)
- [ ] 출시 후 모니터링 셋업: Sentry, 콘솔 신고 내역, Actions 실패 알림

**DoD**: 토스 앱에서 미니앱 라이브, 광고 노출 확인, 모니터링 가동.

## Phase 4 — v2 (트래픽 검증 후)

우선순위는 출시 후 지표(PRD §8)로 재결정한다.

- [ ] 보상형 광고 + 프리미엄 콘텐츠 (혼잡 추이 히스토리 — 파이프라인에 스냅샷 누적 필요)
- [ ] 즐겨찾기 (로컬 저장)
- [ ] 공유하기 (랭킹 카드)
- [ ] 지도 뷰

## 단계 간 공통 게이트

모든 Phase 완료 시:
1. 코드 리뷰 (code-reviewer 에이전트) — CRITICAL/HIGH 이슈 0건
2. 테스트 통과 + 커버리지 80%+ (로직 계층)
3. 문서 갱신 (결정 변경 시 해당 문서 반영)
4. conventional commit 으로 커밋
