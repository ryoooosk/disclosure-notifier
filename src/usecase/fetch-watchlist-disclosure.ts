import { fetchEdinetdbEvents } from '../data-source/edinetdb/fetch-events.ts';
import { fetchDisclosures } from '../data-source/tdnet/fetch-disclosures.ts';
import { loadWatchList } from '../data-source/watchlist/load-watch-list.ts';
import { edinetdbEventType } from '../lib/edinetdb.ts';
import type { Disclosure } from '../model/disclosure.ts';
import { toJstDate } from '../utils.ts';

/**
 * @description 基準時刻の時点で通知すべき、ウォッチリスト銘柄の開示を集める。
 * TDnet は基準時刻が JST で属する日、EDINET DB は基準時刻までの 1 日に検知された分を対象にする
 */
export default async function fetchWatchlistDisclosure(
  baseTime: Date,
): Promise<{ disclosures: Disclosure[]; totalCount: number }> {
  const [tdnet, edinetdb] = await Promise.all([
    fetchTdnet(toJstDate(baseTime)),
    fetchEdinetdb(baseTime),
  ]);

  const targetCodes = loadWatchList();

  return {
    disclosures: [...tdnet.disclosures, ...edinetdb.disclosures].filter((d) =>
      targetCodes.has(d.code),
    ),
    totalCount: tdnet.totalCount + edinetdb.totalCount,
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
 * @description 前回の基準時刻から今回の基準時刻までに取り込まれた法定開示を EDINET DB から取得する。
 * event_date で絞らないのは、大量保有系の event_date が提出日ではなく報告義務発生日で、同じ日付のイベントが数営業日にわたって追加されるため。
 * 前回の基準時刻は保存していないので、実行間隔ぶん遡った時刻で代用する。
 * 範囲は [前回, 今回) の半開区間なので、基準時刻が実行間隔ちょうどで進む限り、重複も取りこぼしも出ない
 */
async function fetchEdinetdb(baseTime: Date): Promise<{
  disclosures: readonly Disclosure[];
  totalCount: number;
}> {
  /** 前回の実行から今回までの間隔。1 日 1 回、同じ時刻を基準時刻にして動かしている */
  const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const detectedSince = new Date(
    baseTime.getTime() - RUN_INTERVAL_MS,
  ).toISOString();

  // TDnet にも出る決算短信・TOB・自己株取得などは同じ開示が二重に届くので、EDINET にしか出ない法定開示だけに絞る
  const edinetdbOnlyEventTypes = [
    edinetdbEventType.yuhou,
    edinetdbEventType.yuhouCorrection,
    edinetdbEventType.semiAnnualReport,
    edinetdbEventType.largeHoldingReport,
    edinetdbEventType.largeHoldingChange,
  ];

  const { disclosures, skippedEvents, undatedCount, totalCount } =
    await fetchEdinetdbEvents({
      detectedSince,
      detectedBefore: baseTime,
      eventTypes: edinetdbOnlyEventTypes,
    });

  // 上限で絞れなかった分は次回の範囲にも入りうる。続くようなら EDINET DB 側のレスポンス変化を疑う
  if (undatedCount > 0) {
    console.warn(
      `EDINET DB の ${undatedCount} 件は detected_at が読めず、取得範囲の上限で絞れませんでした`,
    );
  }

  // 読めずに捨てたイベントは EDINET DB 側のレスポンス変化のサイン
  if (skippedEvents.length > 0) {
    console.warn(
      `EDINET DB で読み取れなかったイベントが ${skippedEvents.length} 件あります:`,
    );
    for (const event of skippedEvents) {
      console.warn(`  [${event.index}] ${event.reason}`);
    }
  }

  return { disclosures, totalCount };
}
