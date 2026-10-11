import { loadEnv } from '../../config/env.ts';
import { politeFetch } from '../../lib/fetch-client.ts';
import { extractZipEntry } from '../../lib/zip.ts';

const API_BASE_URL = 'https://api.edinet-fsa.go.jp/api/v2/';
/** EDINET コードリスト（日本語）の固定リンク。API キーは要らない */
const CODE_LIST_URL =
  'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip';
const CODE_LIST_ENTRY = 'EdinetcodeDlInfo.csv';
/** 書類の PDF。閲覧サイトの「PDF 表示」と同じもので、API キーは要らない */
const DOCUMENT_PDF_BASE_URL =
  'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/';

/** 書類種別コード（docTypeCode）。全 40 種余りのうち、通知対象になりそうなものだけ持つ */
export const edinetDocTypeCode = {
  /** 有価証券報告書 */
  annualReport: '120',
  /** 訂正有価証券報告書 */
  annualReportCorrection: '130',
  /** 半期報告書。2024 年の四半期報告書廃止で、上場会社も第 2 四半期報告書の代わりに出すようになった */
  semiAnnualReport: '160',
  /** 大量保有報告書。提出後に保有割合が動いたときの変更報告書も同じコードで出る */
  largeHoldingReport: '350',
} as const;
export type EdinetDocTypeCode =
  (typeof edinetDocTypeCode)[keyof typeof edinetDocTypeCode];

/**
 * @description ファイル日付に提出処理された書類の一覧を取得する。
 * 当日分は JST 8:30 過ぎから 1 分ごとに更新される。
 * パラメータの誤りなどは HTTP 200 のまま本文の metadata.status で返るので、呼び出し側で見る
 * @param date ファイル日付（JST, YYYY-MM-DD）
 */
export async function requestEdinetDocuments(date: string): Promise<unknown> {
  const { EDINET_API_KEY } = loadEnv();
  // 仕様上 API キーはクエリでしか渡せないので、URL をエラーに載せず日付だけにする
  const query = new URLSearchParams({
    date,
    type: '2', // 提出書類一覧とメタデータ。1 だとメタデータ（件数）しか返らない
    'Subscription-Key': EDINET_API_KEY,
  });
  const response = await politeFetch(`${API_BASE_URL}documents.json?${query}`);

  // API キーの誤り（401）と回数制限（429）だけは HTTP ステータスにも出る
  if (!response.ok) {
    throw new Error(
      `EDINET の書類一覧を取得できませんでした (HTTP ${response.status}, date=${date})`,
    );
  }

  return await response.json();
}

/**
 * @description EDINET コードリストを取得し、CSV の文字列にして返す。
 * zip で配られ、中の CSV は Shift_JIS で書かれている
 */
export async function requestEdinetCodeList(): Promise<string> {
  const response = await politeFetch(CODE_LIST_URL);

  if (!response.ok) {
    throw new Error(
      `EDINET コードリストを取得できませんでした (HTTP ${response.status})`,
    );
  }

  const zip = new Uint8Array(await response.arrayBuffer());
  const csv = extractZipEntry(zip, CODE_LIST_ENTRY);
  // WHATWG の shift_jis は Windows-31J 相当なので、丸付き数字などの機種依存文字も読める
  return new TextDecoder('shift_jis').decode(csv);
}

/** @description 書類管理番号（docID）から PDF の URL を組む */
export const edinetDocumentPdfUrl = (docId: string) =>
  `${DOCUMENT_PDF_BASE_URL}${encodeURIComponent(docId)}.pdf`;
