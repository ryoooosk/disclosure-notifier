/** 定時実行の基準時刻（JST）。cron の `30 8 * * *`（UTC）にあたる */
const SCHEDULED_JST_TIME = '17:30';

/**
 * @description JST の日付（YYYY-MM-DD）を、その日の定時実行の基準時刻にする
 */
export const toScheduledTime = (date: string) =>
  new Date(`${date}T${SCHEDULED_JST_TIME}:00+09:00`);

/**
 * @description 指定した時刻が JST で何日にあたるかを YYYY-MM-DD 形式で返す
 */
export const toJstDate = (at: Date) =>
  at
    .toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replaceAll('/', '-');

/** @description HTML に埋め込む文字列の特殊文字を文字実体参照へ置き換える */
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    // 正規表現に列挙した 5 文字しか渡ってこないので、キーは必ず引ける。
    // TS はインデックスアクセスを string | undefined と推論するため断言で潰す
    (c) =>
      ({
        // & 自身も実体参照の先頭文字なので、最初に置換対象へ含めておく
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );
