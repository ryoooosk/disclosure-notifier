import { setTimeout as sleep } from 'node:timers/promises';

const USER_AGENT = 'disclosure-notifier';
/** 配信元への負荷を抑えるための最小リクエスト間隔 */
const MIN_REQUEST_INTERVAL_MS = 1_000;
type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH' | 'HEAD';

let lastRequestAt = 0;

/**
 * @description リクエスト間隔を最低 1 秒空け、User-Agent を明示して取得する。
 * 直前の時刻を見て待つだけの排他制御なので、**逐次呼び出しが前提**。
 * 並行に呼ぶと両方が同時に「待ち時間なし」と判断して間隔が守られない。
 * 待ち時間はモジュール変数で持つため、間隔は取得先ごとではなく
 * この関数を使う全呼び出しで共有される。
 */
export async function politeFetch(
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();

  return _fetch('GET', url, headers);
}

/**
 * @description User-Agent を明示して取得し、通信そのものの失敗だけ Error に揃える。
 */
async function _fetch(
  method: HttpMethod,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, ...headers },
    });
  } catch (cause) {
    // DNS 解決失敗・接続断・中断など。fetch はこれらをまとめて TypeError で投げる
    throw new Error(`${method} ${url} に接続できませんでした`, { cause });
  }
}
