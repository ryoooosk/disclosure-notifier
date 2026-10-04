import assert from 'node:assert/strict';
import { afterEach, before, describe, mock, test } from 'node:test';
import { fetchEdinetdbEvents } from './fetch-events.ts';

/** 取得範囲の上限。定時実行の基準時刻（JST 17:30）にあたる */
const DETECTED_BEFORE = new Date('2026-09-28T08:30:00Z');

function event(eventId: string, detectedAt?: string | null) {
  return {
    event_id: eventId,
    event_date: '2026-09-28',
    ...(detectedAt === undefined ? {} : { detected_at: detectedAt }),
    title: '有価証券報告書－第10期',
    event_type: 'yuhou',
    sec_code: '7203',
    filer_name: 'トヨタ自動車株式会社',
  };
}

/** @description 1 ページで返し切るイベント一覧を fetch の応答として差し込む */
function stubEvents(events: readonly unknown[]) {
  const body = {
    data: events,
    meta: { pagination: { total: events.length, limit: 1000, offset: 0 } },
  };
  return mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify(body), { status: 200 }),
  );
}

describe('fetchEdinetdbEvents の取得範囲の上限', () => {
  before(() => {
    // API キーの読み込みで全項目が検証されるため、ダミー値で埋めておく
    process.env.RESEND_API_KEY = 'dummy';
    process.env.EMAIL_FROM = 'from@example.com';
    process.env.EMAIL_TO = 'to@example.com';
    process.env.EDINET_DB_API_KEY = 'dummy';
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('上限ちょうどに検知されたものは含めず、その直前までを含める', async () => {
    stubEvents([
      event('just-before', '2026-09-28T08:29:59.999Z'),
      event('at-boundary', '2026-09-28T08:30:00Z'),
      event('after', '2026-09-28T09:00:00Z'),
    ]);

    const { disclosures, undatedCount } = await fetchEdinetdbEvents({
      detectedSince: '2026-09-27T08:30:00.000Z',
      detectedBefore: DETECTED_BEFORE,
    });

    assert.deepEqual(
      disclosures.map((d) => d.originalId),
      ['just-before'],
    );
    assert.equal(undatedCount, 0);
  });

  test('+09:00 で書かれた detected_at も同じ瞬間として比べる', async () => {
    stubEvents([
      event('before-jst', '2026-09-28T17:29:59+09:00'),
      event('at-boundary-jst', '2026-09-28T17:30:00+09:00'),
    ]);

    const { disclosures } = await fetchEdinetdbEvents({
      detectedBefore: DETECTED_BEFORE,
    });

    assert.deepEqual(
      disclosures.map((d) => d.originalId),
      ['before-jst'],
    );
  });

  test('detected_at が無いイベントは取りこぼさずに残し、件数を数える', async () => {
    stubEvents([
      event('missing'),
      event('null', null),
      event('broken', 'not-a-date'),
    ]);

    const { disclosures, undatedCount } = await fetchEdinetdbEvents({
      detectedBefore: DETECTED_BEFORE,
    });

    assert.equal(disclosures.length, 3);
    assert.equal(undatedCount, 3);
  });

  test('上限を指定しなければ detected_at を見ない', async () => {
    stubEvents([event('after', '2026-09-28T09:00:00Z'), event('missing')]);

    const { disclosures, undatedCount } = await fetchEdinetdbEvents();

    assert.equal(disclosures.length, 2);
    assert.equal(undatedCount, 0);
  });

  test('上限は API に送らない', async () => {
    const fetchMock = stubEvents([]);

    await fetchEdinetdbEvents({
      detectedSince: '2026-09-27T08:30:00.000Z',
      detectedBefore: DETECTED_BEFORE,
    });

    const url = String(fetchMock.mock.calls[0]?.arguments[0]);
    assert.match(url, /detected_since=/);
    assert.doesNotMatch(url, /before/i);
  });
});
