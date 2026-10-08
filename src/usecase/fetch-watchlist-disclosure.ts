import { fetchEdinetDocuments } from '../data-source/edinet/fetch-documents.ts';
import { fetchDisclosures } from '../data-source/tdnet/fetch-disclosures.ts';
import { loadWatchList } from '../data-source/watchlist/load-watch-list.ts';
import type { Disclosure } from '../model/disclosure.ts';
import { toJstDate } from '../utils.ts';

/**
 * @description 基準時刻の時点で通知すべき、ウォッチリスト銘柄の開示を集める。
 * TDnet は基準時刻が JST で属する日、EDINET は基準時刻までの 1 日に提出された分を対象にする
 */
export default async function fetchWatchlistDisclosure(
  baseTime: Date,
): Promise<{ disclosures: Disclosure[]; totalCount: number }> {
  const [tdnet, edinet] = await Promise.all([
    fetchTdnet(toJstDate(baseTime)),
    fetchEdinet(baseTime),
  ]);

  const targetCodes = loadWatchList();

  return {
    disclosures: [...tdnet.disclosures, ...edinet.disclosures].filter((d) =>
      targetCodes.has(d.code),
    ),
    totalCount: tdnet.totalCount + edinet.totalCount,
  };
}

async function fetchTdnet(
  date: string,
): Promise<{ disclosures: readonly Disclosure[]; totalCount: number }> {
  const res = await fetchDisclosures(date);

  if (res.status === 'notFound') {
    throw new Error(`${date} の一覧ページが見つかりませんでした`);
  }
  if (res.status === 'notModified') {
    console.warn('前回の取得から更新がありません。');
    return { disclosures: [], totalCount: 0 };
  }

  const { disclosures, skippedRows, totalCount } = res.value;

  // 読めずに捨てた行は TDnet 側の構造変化のサイン。
  if (skippedRows.length > 0) {
    console.warn(`読み取れなかった行が ${skippedRows.length} 件あります:`);
    for (const row of skippedRows) {
      console.warn(`  [${row.index}] ${row.reason}`);
    }
  }

  return { disclosures, totalCount };
}

/**
 * @description 前回の基準時刻から今回の基準時刻までに提出された法定開示を EDINET から取得する。
 * 大量保有報告書も報告義務発生日ではなく提出日時で絞るので、遅れて出た報告書も提出された回で拾える。
 * 前回の基準時刻は保存していないので、実行間隔ぶん遡った時刻で代用する。
 * 範囲は [前回, 今回) の半開区間なので、基準時刻が実行間隔ちょうどで進む限り、重複も取りこぼしも出ない
 */
async function fetchEdinet(baseTime: Date): Promise<{
  disclosures: readonly Disclosure[];
  totalCount: number;
}> {
  /** 前回の実行から今回までの間隔。1 日 1 回、同じ時刻を基準時刻にして動かしている */
  const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

  const { disclosures, skippedDocuments, totalCount } =
    await fetchEdinetDocuments({
      submittedSince: new Date(baseTime.getTime() - RUN_INTERVAL_MS),
      submittedBefore: baseTime,
    });

  // 読めずに捨てた書類は EDINET 側のレスポンス変化のサイン
  if (skippedDocuments.length > 0) {
    console.warn(
      `EDINET で読み取れなかった書類が ${skippedDocuments.length} 件あります:`,
    );
    for (const document of skippedDocuments) {
      console.warn(`  [${document.date} ${document.index}] ${document.reason}`);
    }
  }

  return { disclosures, totalCount };
}
