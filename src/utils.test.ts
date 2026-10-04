import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { toJstDate } from './utils.ts';

describe('toJstDate', () => {
  test('UTC で前日でも、JST で日付が変わっていれば翌日を返す', () => {
    assert.equal(toJstDate(new Date('2026-09-28T15:00:00Z')), '2026-09-29');
  });

  test('JST 0 時の直前は当日を返す', () => {
    assert.equal(toJstDate(new Date('2026-09-28T14:59:59Z')), '2026-09-28');
  });

  test('定時実行の基準時刻（UTC 08:30）は同じ日付になる', () => {
    assert.equal(toJstDate(new Date('2026-09-28T08:30:00Z')), '2026-09-28');
  });
});
