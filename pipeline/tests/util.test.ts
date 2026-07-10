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
