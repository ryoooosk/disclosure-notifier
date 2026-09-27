import { loadEnv } from '../config/env.ts';
import { politeFetch } from './fetch-client.ts';

const BASE_URL = 'https://edinetdb.jp/v1/';

/** イベント種別（event_type）。全 35 種のうち、通知対象になりそうなものだけ持つ。*/
export const edinetdbEventType = {
  /** 有価証券報告書 */
  yuhou: 'yuhou',
  /** 訂正有価証券報告書 */
  yuhouCorrection: 'yuhou_correction',
  /** 半期報告書。2024 年の四半期報告書廃止で新設された法定開示 */
  semiAnnualReport: 'semi_annual_report',
  /** 決算短信 */
  earningsSummary: 'earnings_summary',
  /** 大量保有報告書 */
  largeHoldingReport: 'large_holding_report',
  /** 変更報告書。大量保有報告書の提出後に保有割合が動いたときに出る */
  largeHoldingChange: 'large_holding_change',
  /** 公開買付け */
  tenderOffer: 'tender_offer',
  mbo: 'mbo',
  merger: 'merger',
  /** 子会社の異動 */
  subsidiaryStatusChange: 'subsidiary_status_change',
  businessAlliance: 'business_alliance',
  /**
   * 自己株式の取得。2026-08-16 に自己株式の処分が treasury_share_disposal へ
   * 分離されたため、この種別に処分は含まれない
   */
  buyback: 'buyback',
} as const;
export type EdinetdbEventType =
  (typeof edinetdbEventType)[keyof typeof edinetdbEventType];

/** イベントの大分類（event_category）。event_type より粗く絞りたいときに使う */
export const edinetdbEventCategory = [
  'earnings',
  'governance',
  'corporate_action',
  'holding', // 大量保有など、保有状況の変化
  'legal_filing', // 有報・半期報告書などの法定開示
  'calendar',
  'other',
] as const;
export type EdinetdbEventCategory = (typeof edinetdbEventCategory)[number];

/** 重要度（severity）。EDINET DB 側が付ける */
export const edinetdbSeverity = ['critical', 'high', 'medium', 'low'] as const;
export type EdinetdbSeverity = (typeof edinetdbSeverity)[number];

export interface RequestEdinetdbEventsParams {
  /**
   * event_date の開始日（YYYY-MM-DD）。省略時は API 側の既定で 7 日前。
   * 大量保有系の event_date は提出日ではなく報告義務発生日なので、
   * 同じ日付のイベントが数営業日にわたって追加される
   */
  readonly since?: string;
  /** 終了日（YYYY-MM-DD）。省略時は API 側の既定で当日 */
  readonly until?: string;
  readonly secCode?: string;
  readonly edinetCode?: string;
  readonly eventTypes?: readonly EdinetdbEventType[];
  readonly eventCategory?: EdinetdbEventCategory;
  readonly severity?: readonly EdinetdbSeverity[];
  /** 1 回あたりの件数。既定 100、最大 1000 */
  readonly limit?: number;
  readonly offset?: number;
  /**
   * この日時以降に検知されたものだけを返す差分同期用のカーソル。
   * event_date ではなく detected_at で絞るため、
   * 遅れて登録された過去日のイベントも取りこぼさない。
   * RFC3339 か YYYY-MM-DD（タイムゾーン省略時は UTC）。境界は >= なので、
   * 前回の detected_at 最大値を渡すと境界の行が重複しうる。
   * 指定時に since を省略すると、event_date の既定の窓が直近 35 日に広がる
   */
  readonly detectedSince?: string;
}

/**
 * @description 条件に一致するイベントを取得する。
 */
export async function requestEdinetdbEvents(
  params: RequestEdinetdbEventsParams = {},
): Promise<unknown> {
  const query = new URLSearchParams();
  if (params.since) query.set('since', params.since);
  if (params.until) query.set('until', params.until);
  if (params.secCode) query.set('sec_code', params.secCode);
  if (params.edinetCode) query.set('edinet_code', params.edinetCode);
  // 複数指定はカンマ区切り
  if (params.eventTypes?.length) {
    query.set('event_type', params.eventTypes.join(','));
  }
  if (params.eventCategory) query.set('event_category', params.eventCategory);
  if (params.severity?.length) query.set('severity', params.severity.join(','));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.detectedSince) query.set('detected_since', params.detectedSince);

  const url = `${BASE_URL}events?${query}`;
  const response = await politeFetch(url, authHeader());

  if (!response.ok) {
    throw new Error(
      `EDINET DB のイベントを取得できませんでした (HTTP ${response.status}, ${query})`,
    );
  }

  return await response.json();
}

/**
 * @description 企業の基本情報と最新の財務データを取得する。
 * イベントは edinet_code しか持たない場合があるため、証券コードや企業名を補うのに使う。
 * @param code EDINET コード（`E02367` など）
 */
export async function requestEdinetdbCompany(code: string): Promise<unknown> {
  const url = `${BASE_URL}companies/${code}`;
  const response = await politeFetch(url, authHeader());

  if (!response.ok) {
    throw new Error(
      `EDINET DB の企業情報を取得できませんでした (HTTP ${response.status}, code=${code})`,
    );
  }

  return await response.json();
}

function authHeader(): Record<string, string> {
  const { EDINET_DB_API_KEY } = loadEnv();

  return { 'X-API-Key': EDINET_DB_API_KEY };
}
