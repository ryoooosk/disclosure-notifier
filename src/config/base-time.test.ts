import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseBaseTime } from './base-time.ts';

/** @description 現在時刻を基準時刻にしたかを、呼び出しの前後の時刻で挟んで確かめる */
function assertNow(args: readonly string[]) {
  const before = Date.now();
  const baseTime = parseBaseTime(args).getTime();

  assert.ok(before <= baseTime && baseTime <= Date.now());
}

describe('parseBaseTime', () => {
  test('引数が無ければ現在時刻を基準時刻にする', () => {
    assertNow([]);
  });

  test('空文字は未指定と同じに扱う', () => {
    assertNow(['--scheduled-at', '']);
  });

  test('日付だけなら、その日の定時実行（JST 17:30）を基準時刻にする', () => {
    assert.equal(
      parseBaseTime(['--scheduled-at', '2026-09-28']).toISOString(),
      '2026-09-28T08:30:00.000Z',
    );
  });

  test('日時はその時刻を基準時刻にする', () => {
    assert.equal(
      parseBaseTime(['--scheduled-at=2026-09-28T08:30:00Z']).toISOString(),
      '2026-09-28T08:30:00.000Z',
    );
  });

  test('+09:00 で書かれた日時も同じ瞬間として読む', () => {
    assert.equal(
      parseBaseTime([
        '--scheduled-at',
        '2026-09-28T17:30:00+09:00',
      ]).toISOString(),
      '2026-09-28T08:30:00.000Z',
    );
  });

  test('日付としても日時としても読めない値は現在時刻に倒さず投げる', () => {
    assert.throws(
      () => parseBaseTime(['--scheduled-at', '2026/09/28']),
      /--scheduled-at は YYYY-MM-DD か ISO 8601/,
    );
  });

  test('知らない引数は打ち間違いとして投げる', () => {
    assert.throws(() => parseBaseTime(['--date', '2026-09-28']));
  });
});
