import z from 'zod';
import {
  type EdinetdbEventType,
  type RequestEdinetdbEventsParams,
  requestEdinetdbEvents,
} from '../../lib/edinetdb.ts';
import type { Disclosure, DisclosureKind } from '../../model/disclosure.ts';

/** 1 回のリクエストで取れる最大件数 */
const PAGE_SIZE = 1000;
/** 4 桁の証券コード。TDnet と同じく英字を含むものが実在する */
const CODE_PATTERN = /^[0-9A-Za-z]{4}$/;

/**
 * event_type から開示種別への対応。ここに無い種別は other に落とす。
 */
const KIND_BY_EVENT_TYPE: Readonly<Record<EdinetdbEventType, DisclosureKind>> =
  {
    yuhou: 'annualReport',
    yuhou_correction: 'annualReport',
    semi_annual_report: 'semiAnnualReport',
    earnings_summary: 'earnings',
    large_holding_report: 'largeHolding',
    large_holding_change: 'largeHolding',
    tender_offer: 'tenderOffer',
    mbo: 'tenderOffer',
    merger: 'merger',
    subsidiary_status_change: 'subsidiary',
    business_alliance: 'alliance',
    buyback: 'buyback',
  };

/**
 * @description KIND_BY_EVENT_TYPE に載っている種別かを判定する。
 * in ではなく hasOwn で見るのは、constructor などプロトタイプ由来のキーを弾くため
 */
function isKnownEventType(type: string): type is EdinetdbEventType {
  return Object.hasOwn(KIND_BY_EVENT_TYPE, type);
}

/**
 * イベント 1 件。Disclosure に載る値だけを持つ。
 */
const edinetdbEvent = z.object({
  /** イベントの一意キー。EDINET の書類管理番号（docID）ではなく EDINET DB 独自のハッシュ */
  event_id: z.string(),
  /** 発生日（JST, YYYY-MM-DD） */
  event_date: z.string(),
  /**
   * 発生日時（RFC3339）。REST のドキュメントには載っているが実際のレスポンスでは
   * 確認できなかったため任意にしてある。無ければ event_date が唯一の時刻情報になる
   */
  event_timestamp: z.string().nullish(),
  /** 書類名・開示の表題。メール本文の見出しに使う */
  title: z.string(),
  event_type: z.string(),
  /** 証券コード。投資信託の受益証券など、非上場の提出者では null */
  sec_code: z.string().nullable(),
  filer_name: z.string().nullable(),
});
type EdinetdbEvent = z.infer<typeof edinetdbEvent>;

const edinetdbEventListResponse = z.object({
  data: z.array(z.unknown()),
  meta: z.object({
    pagination: z.object({
      total: z.number(), // 条件に一致した総件数。limit を超えた分は offset で取りに行く
      limit: z.number(),
      offset: z.number(),
    }),
  }),
});

/** 想定した形に読めず捨てたイベント。ログに出して EDINET DB 側の変化に気づくために持つ */
interface SkippedEvent {
  readonly index: number; // 条件に一致したイベント全体での通し番号
  readonly reason: string;
  readonly raw: unknown;
}

/** 条件に一致したイベントを読み切った結果 */
interface EdinetdbEvents {
  readonly disclosures: readonly Disclosure[];
  /**
   * 条件に一致した総件数。証券コードを持たない提出者を除くため、
   * disclosures.length より大きくなるのが普通
   */
  readonly totalCount: number;
  readonly skippedEvents: readonly SkippedEvent[];
}

/** 1 件を読んだ結果。捨てた理由と、対象外なだけの場合を区別する */
type ReadResult =
  | { readonly status: 'ok'; readonly disclosure: Disclosure }
  | { readonly status: 'skipped'; readonly reason: string }
  /** 証券コードを持たない提出者。異常ではないので skippedEvents には積まない */
  | { readonly status: 'notListed' };

/**
 * @description 条件に一致するイベントをページ送りしながら全件取得し、Disclosure に変換できたものだけを返す。
 * 読めなかった要素は捨ててskippedEvents に積み、呼び出し側がログに出して気づけるようにする。
 * 外枠（data / meta）が読めない場合だけ、API の構造が変わったとみなして投げる。
 */
export async function fetchEdinetdbEvents(
  params: Omit<RequestEdinetdbEventsParams, 'limit' | 'offset'> = {},
): Promise<EdinetdbEvents> {
  const disclosures: Disclosure[] = [];
  const skippedEvents: SkippedEvent[] = [];
  let totalCount = 0;
  let offset = 0;

  do {
    const edinetEvent = await requestEdinetdbEvents({
      ...params,
      limit: PAGE_SIZE,
      offset,
    });
    const response = edinetdbEventListResponse.parse(edinetEvent);
    totalCount = response.meta.pagination.total;

    for (const [index, raw] of response.data.entries()) {
      const read = readEvent(raw);
      if (read.status === 'notListed') continue;
      if (read.status === 'skipped') {
        skippedEvents.push({ index: offset + index, reason: read.reason, raw });
        continue;
      }

      disclosures.push(read.disclosure);
    }

    // 取得中に件数が増えて total に追いつけないことがあるので、
    // 空のページが返ったら打ち切る
    if (response.data.length === 0) break;
    // limit はサーバー側で切り下げられうるため、要求した件数ではなく
    // 実際に返ってきた件数で進める
    offset += response.data.length;
  } while (offset < totalCount);

  return { disclosures, totalCount, skippedEvents };
}

/** @description イベント 1 件を読み、Disclosure に変換できるかを判定する。*/
function readEvent(raw: unknown): ReadResult {
  const parsed = edinetdbEvent.safeParse(raw);
  if (!parsed.success) {
    return { status: 'skipped', reason: z.prettifyError(parsed.error) };
  }
  const event = parsed.data;

  // 投資信託の受益証券など、ウォッチリストと照合しようがない提出者の開示
  if (event.sec_code === null) return { status: 'notListed' };

  const problem = findProblem(event);
  if (problem !== null) return { status: 'skipped', reason: problem };

  return { status: 'ok', disclosure: toDisclosure(event) };
}

/**
 * @description イベントを Disclosure に変換する。
 * 証券コードが 4 桁で届くこと、文書 URL を組めないことが TDnet との違い。
 * findProblem() を通った値だけを渡す前提で、ここでは検査しない。
 */
function toDisclosure(event: EdinetdbEvent): Disclosure {
  return {
    source: 'edinetdb',
    originalId: event.event_id,
    code: (event.sec_code ?? '').toUpperCase(),
    companyName: event.filer_name ?? '',
    title: event.title,
    kind: isKnownEventType(event.event_type)
      ? KIND_BY_EVENT_TYPE[event.event_type]
      : 'other',
    // EDINET DB は docID を返さないため、PDF を指す URL が組めない
    documentUrl: null,
    disclosedAt: new Date(rawDisclosedAt(event)).toISOString(),
  };
}

/**
 * @description 開示日時の元になる文字列を組む。
 * event_timestamp を持たないイベントは日付しか情報が無いので JST の 0 時として扱う。
 * メールの時刻欄には 00:00 と出るが、法定開示は日単位でしか届かないので粒度は合っている
 */
function rawDisclosedAt(event: EdinetdbEvent): string {
  return event.event_timestamp ?? `${event.event_date}T00:00:00+09:00`;
}

function findProblem(event: EdinetdbEvent): string | null {
  if (!CODE_PATTERN.test(event.sec_code ?? '')) {
    return `証券コードが 4 桁ではありません: ${JSON.stringify(event.sec_code)}`;
  }
  if (event.filer_name === null || event.filer_name === '') {
    return '提出者名が空です';
  }
  if (event.title === '') return '表題が空です';
  if (Number.isNaN(new Date(rawDisclosedAt(event)).getTime())) {
    return `日時を解釈できませんでした: ${JSON.stringify(rawDisclosedAt(event))}`;
  }
  return null;
}
