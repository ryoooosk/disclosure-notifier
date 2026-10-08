import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import { buildZip } from '../../testing/build-zip.ts';
import { encodeShiftJis } from '../../testing/encode-shift-jis.ts';
import { fetchEdinetDocuments } from './fetch-documents.ts';

const API_KEY = 'dummy-edinet-key';

/** Date.now の代わりに返す時刻。テストをまたいで進み続ける */
let fakeNow = 0;

/** 定時実行の基準時刻（JST 17:30）とその 24 時間前。ファイル日付は 09-27 と 09-28 にかかる */
const RANGE = {
  submittedSince: new Date('2026-09-27T08:30:00Z'),
  submittedBefore: new Date('2026-09-28T08:30:00Z'),
};

/** @description 書類一覧の 1 件。指定しなければ、上場会社の有報で取得範囲に入るものになる */
function document(overrides: Record<string, unknown> = {}) {
  return {
    seqNumber: 1,
    docID: 'S100AAAA',
    edinetCode: 'E02144',
    secCode: '72030',
    JCN: '1180301018771',
    filerName: 'トヨタ自動車株式会社',
    fundCode: null,
    ordinanceCode: '010',
    formCode: '030000',
    docTypeCode: '120',
    periodStart: '2025-04-01',
    periodEnd: '2026-03-31',
    submitDateTime: '2026-09-28 15:00',
    docDescription: '有価証券報告書－第122期(2025/04/01－2026/03/31)',
    issuerEdinetCode: null,
    subjectEdinetCode: null,
    subsidiaryEdinetCode: null,
    currentReportReason: null,
    parentDocID: null,
    opeDateTime: null,
    withdrawalStatus: '0',
    docInfoEditStatus: '0',
    disclosureStatus: '0',
    xbrlFlag: '1',
    pdfFlag: '1',
    attachDocFlag: '1',
    englishDocFlag: '0',
    csvFlag: '1',
    legalStatus: '1',
    ...overrides,
  };
}

/** @description 大量保有報告書。提出者は保有者で、発行会社は issuerEdinetCode にだけ出る */
function largeHolding(overrides: Record<string, unknown> = {}) {
  return document({
    docID: 'S100BBBB',
    edinetCode: 'E39581',
    secCode: null,
    filerName: '株式会社Ｂｌｕｅ　ｌａｇｏｏｎ',
    ordinanceCode: '060',
    formCode: '053000',
    docTypeCode: '350',
    periodStart: null,
    periodEnd: null,
    docDescription: '変更報告書',
    issuerEdinetCode: 'E03498',
    ...overrides,
  });
}

/** EDINET コードリストの中身。英字の社名にカンマを含む行と、非上場の行を混ぜてある */
const CODE_LIST_CSV = [
  'ダウンロード実行日,2026年09月28日現在,件数,3件',
  'ＥＤＩＮＥＴコード,提出者種別,上場区分,連結の有無,資本金,決算日,提出者名,提出者名（英字）,提出者名（ヨミ）,所在地,提出者業種,証券コード,提出者法人番号',
  '"E03498","内国法人・組合","上場","有","1422","2月末日","スターシーズ株式会社","Star seeds Co.,Ltd.","スターシーズカブシキガイシャ","港区新橋四丁目２１番３号","小売業","30830","6010001072528"',
  '"E00410","内国法人・組合","上場","有","378","3月31日","オリオンビール株式会社","orion breweries,ltd.","オリオンビールカブシキガイシャ","豊見城市字豊崎１番地４１１","食料品","409A0","7360001008504"',
  '"E39581","内国法人・組合（有価証券報告書等の提出義務者以外）","","","1","","株式会社Ｂｌｕｅ　ｌａｇｏｏｎ","","カブシキガイシャブルーラグーン","三浦市三崎町諸磯浜ノ原１８９５番地９","内国法人・組合（有価証券報告書等の提出義務者以外）","","9021001075368"',
  '',
].join('\r\n');

/**
 * @description ファイル日付ごとの書類一覧と EDINET コードリストを fetch の応答として差し込む。
 * 一覧を渡していない日付は、書類の無い日として空の一覧を返す
 */
function stubEdinet(
  lists: Readonly<Record<string, readonly unknown[]>>,
  codeList: Uint8Array<ArrayBuffer> = buildZip({
    'EdinetcodeDlInfo.csv': encodeShiftJis(CODE_LIST_CSV),
  }),
) {
  return mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/Edinetcode.zip')) {
      return new Response(codeList, { status: 200 });
    }

    const date = url.searchParams.get('date') ?? '';
    const results = lists[date] ?? [];
    const body = {
      metadata: {
        title: '提出された書類を把握するためのAPI',
        parameter: { date, type: '2' },
        resultset: { count: results.length },
        processDateTime: `${date} 17:31`,
        status: '200',
        message: 'OK',
      },
      results,
    };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

/** @description fetch に渡った URL を、API キーを除いて読める形にする */
function requestedUrls(fetchMock: ReturnType<typeof stubEdinet>): string[] {
  return fetchMock.mock.calls.map((call) => {
    const url = new URL(String(call.arguments[0]));
    url.searchParams.delete('Subscription-Key');
    return url.toString();
  });
}

describe('fetchEdinetDocuments', () => {
  before(() => {
    // API キーの読み込みで全項目が検証されるため、ダミー値で埋めておく
    process.env.RESEND_API_KEY = 'dummy';
    process.env.EMAIL_FROM = 'from@example.com';
    process.env.EMAIL_TO = 'to@example.com';
    process.env.EDINET_API_KEY = API_KEY;
  });

  beforeEach(() => {
    // fetch-client は前回のリクエストから 1 秒空けて送るので、呼ぶたびに時計を進めて待たずに済ませる。
    // 前回の時刻はモジュールに残るため、テストをまたいでも時計が戻らないようにする
    mock.method(Date, 'now', () => {
      fakeNow += 60_000;
      return fakeNow;
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('上場会社の有報を、4 桁コード・PDF の URL・UTC の提出日時を持つ開示にする', async () => {
    stubEdinet({ '2026-09-28': [document()] });

    const { disclosures, totalCount, skippedDocuments } =
      await fetchEdinetDocuments(RANGE);

    assert.deepEqual(disclosures, [
      {
        source: 'edinet',
        originalId: 'S100AAAA',
        code: '7203',
        companyName: 'トヨタ自動車株式会社',
        title: '有価証券報告書－第122期(2025/04/01－2026/03/31)',
        kind: 'annualReport',
        documentUrl:
          'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100AAAA.pdf',
        disclosedAt: '2026-09-28T06:00:00.000Z',
      },
    ]);
    assert.equal(totalCount, 1);
    assert.deepEqual(skippedDocuments, []);
  });

  test('取得範囲にかかる日の書類一覧を、API キーを付けて古い順に取得する', async () => {
    const fetchMock = stubEdinet({});

    await fetchEdinetDocuments(RANGE);

    assert.deepEqual(requestedUrls(fetchMock), [
      'https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2026-09-27&type=2',
      'https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2026-09-28&type=2',
    ]);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.arguments[0]));
    assert.equal(firstUrl.searchParams.get('Subscription-Key'), API_KEY);
  });

  test('上限がちょうど JST 0 時なら、上限の日の一覧は取得しない', async () => {
    const fetchMock = stubEdinet({});

    await fetchEdinetDocuments({
      submittedSince: new Date('2026-09-27T15:00:00Z'), // JST 09-28 0:00
      submittedBefore: new Date('2026-09-28T15:00:00Z'), // JST 09-29 0:00
    });

    assert.deepEqual(requestedUrls(fetchMock), [
      'https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2026-09-28&type=2',
    ]);
  });

  test('下限ちょうどに提出されたものは含め、上限ちょうどのものは含めない', async () => {
    stubEdinet({
      '2026-09-27': [
        document({ docID: 'before-since', submitDateTime: '2026-09-27 17:29' }),
        document({ docID: 'at-since', submitDateTime: '2026-09-27 17:30' }),
      ],
      '2026-09-28': [
        document({ docID: 'before-until', submitDateTime: '2026-09-28 17:29' }),
        document({ docID: 'at-until', submitDateTime: '2026-09-28 17:30' }),
      ],
    });

    const { disclosures, totalCount } = await fetchEdinetDocuments(RANGE);

    assert.deepEqual(
      disclosures.map((d) => d.originalId),
      ['at-since', 'before-until'],
    );
    assert.equal(totalCount, 2);
  });

  test('通知しない種別と、取り下げ・不開示・修正の記録は件数にも数えない', async () => {
    stubEdinet({
      '2026-09-28': [
        document({ docID: 'extraordinary', docTypeCode: '180' }),
        document({ docID: 'withdrawal', withdrawalStatus: '1' }),
        document({ docID: 'withdrawn', withdrawalStatus: '2' }),
        document({ docID: 'edit-record', docInfoEditStatus: '1' }),
        document({ docID: 'undisclosed', disclosureStatus: '2' }),
        document({ docID: 'edited', docInfoEditStatus: '2' }),
      ],
    });

    const { disclosures, totalCount } = await fetchEdinetDocuments(RANGE);

    // 修正された書類そのものは開示として残す
    assert.deepEqual(
      disclosures.map((d) => d.originalId),
      ['edited'],
    );
    assert.equal(totalCount, 1);
  });

  test('証券コードを持たない提出者の書類は、捨てずに件数だけ数える', async () => {
    stubEdinet({
      '2026-09-28': [
        document({
          docID: 'fund',
          edinetCode: 'E12444',
          secCode: null,
          filerName: '三井住友トラスト・アセットマネジメント株式会社',
          docDescription: '有価証券報告書（内国投資信託受益証券）－第3期',
        }),
      ],
    });

    const { disclosures, totalCount, skippedDocuments } =
      await fetchEdinetDocuments(RANGE);

    assert.deepEqual(disclosures, []);
    assert.equal(totalCount, 1);
    assert.deepEqual(skippedDocuments, []);
  });

  test('PDF の無い書類はリンクを付けない', async () => {
    stubEdinet({ '2026-09-28': [document({ pdfFlag: '0' })] });

    const { disclosures } = await fetchEdinetDocuments(RANGE);

    assert.equal(disclosures[0]?.documentUrl, null);
  });

  test('大量保有報告書は発行会社の開示にし、提出者を表題に添える', async () => {
    stubEdinet({ '2026-09-28': [largeHolding()] });

    const { disclosures } = await fetchEdinetDocuments(RANGE);

    assert.equal(disclosures.length, 1);
    assert.equal(disclosures[0]?.code, '3083');
    assert.equal(disclosures[0]?.companyName, 'スターシーズ株式会社');
    assert.equal(
      disclosures[0]?.title,
      '変更報告書（提出者: 株式会社Ｂｌｕｅ　ｌａｇｏｏｎ）',
    );
    assert.equal(disclosures[0]?.kind, 'largeHolding');
  });

  test('英字を含む証券コードの発行会社も引ける', async () => {
    stubEdinet({
      '2026-09-28': [largeHolding({ issuerEdinetCode: 'E00410' })],
    });

    const { disclosures } = await fetchEdinetDocuments(RANGE);

    assert.equal(disclosures[0]?.code, '409A');
    assert.equal(disclosures[0]?.companyName, 'オリオンビール株式会社');
  });

  test('コードリストは大量保有報告書があるときだけ、1 回だけ取得する', async () => {
    const withoutLargeHolding = stubEdinet({ '2026-09-28': [document()] });
    await fetchEdinetDocuments(RANGE);
    assert.ok(
      requestedUrls(withoutLargeHolding).every(
        (url) => !url.endsWith('Edinetcode.zip'),
      ),
    );
    // 時計の差し替えは残したまま、fetch の差し込みだけ入れ替える
    withoutLargeHolding.mock.restore();

    const withLargeHoldings = stubEdinet({
      '2026-09-27': [
        largeHolding({ docID: 'S100CCCC', submitDateTime: '2026-09-27 18:00' }),
      ],
      '2026-09-28': [largeHolding()],
    });
    await fetchEdinetDocuments(RANGE);
    assert.equal(
      requestedUrls(withLargeHoldings).filter((url) =>
        url.endsWith('Edinetcode.zip'),
      ).length,
      1,
    );
  });

  test('非上場の発行会社の大量保有報告書は件数だけ数え、コードリストに無い発行会社は捨てて理由を残す', async () => {
    stubEdinet({
      '2026-09-28': [
        largeHolding({ docID: 'unlisted', issuerEdinetCode: 'E39581' }),
        largeHolding({ docID: 'unknown', issuerEdinetCode: 'E99999' }),
      ],
    });

    const { disclosures, totalCount, skippedDocuments } =
      await fetchEdinetDocuments(RANGE);

    assert.deepEqual(disclosures, []);
    assert.equal(totalCount, 2);
    assert.equal(skippedDocuments.length, 1);
    assert.match(skippedDocuments[0]?.reason ?? '', /E99999/);
    assert.equal(skippedDocuments[0]?.date, '2026-09-28');
    assert.equal(skippedDocuments[0]?.index, 1);
  });

  test('提出日時が読めない書類は捨てて理由を残す', async () => {
    stubEdinet({
      '2026-09-28': [document({ submitDateTime: '2026/09/28 15:00' })],
    });

    const { disclosures, skippedDocuments } = await fetchEdinetDocuments(RANGE);

    assert.deepEqual(disclosures, []);
    assert.match(skippedDocuments[0]?.reason ?? '', /提出日時/);
  });

  test('EDINET が本文でエラーを返したら投げる', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            metadata: {
              title: '提出された書類を把握するためのAPI',
              status: '404',
              message: 'Not Found',
            },
          }),
          { status: 200 },
        ),
    );

    await assert.rejects(fetchEdinetDocuments(RANGE), /status 404: Not Found/);
  });

  test('API キーが無効で HTTP 401 が返ったら、キーを含めずに投げる', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            StatusCode: 401,
            message:
              'Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.',
          }),
          { status: 401 },
        ),
    );

    await assert.rejects(fetchEdinetDocuments(RANGE), (error: Error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    });
  });

  test('通信に失敗したら、キーを含めずに投げる', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });

    await assert.rejects(fetchEdinetDocuments(RANGE), (error: Error) => {
      assert.match(error.message, /documents\.json に接続できませんでした/);
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    });
  });
});
