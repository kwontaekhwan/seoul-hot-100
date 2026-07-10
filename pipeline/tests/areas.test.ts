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
