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
