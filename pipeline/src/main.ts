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
