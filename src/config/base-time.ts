import { parseArgs } from 'node:util';
import z from 'zod';
import { toScheduledTime } from '../utils.ts';

/**
 * 手で後追いするときは日付だけで足りるよう、日付ならその日の定時実行の時刻を補う。
 * Worker は toISOString() の Z 付きで渡す。手で日時を書くときのために +09:00 も受け付ける
 */
const scheduledAtSchema = z.union(
  [
    z.iso.date().transform(toScheduledTime),
    z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  ],
  {
    error:
      '--scheduled-at は YYYY-MM-DD か ISO 8601 の日時で指定してください（例: 2026-09-28、2026-09-28T08:30:00Z）',
  },
);

/**
 * @description コマンドライン引数から処理の基準時刻を決める。TDnet の対象日と EDINET の取得範囲はこの時刻から決まる。
 * Workers Cron から起動したときは予定時刻が渡るので、起動が遅れても対象日はずれない。
 * 未指定なら現在時刻を使う。不正な値は別の日を処理しかねないので、現在時刻に倒さず投げる
 * @param args `process.argv.slice(2)`
 */
export function parseBaseTime(args: readonly string[]): Date {
  // 知らない引数は打ち間違いとみなして投げる（parseArgs の strict の既定）
  const { values } = parseArgs({
    args: [...args],
    options: { 'scheduled-at': { type: 'string' } },
  });

  // ワークフローは入力が無くても空文字で渡すので、未指定と同じに扱う
  const rawScheduledAt = values['scheduled-at'] || undefined;
  if (rawScheduledAt === undefined) return new Date();

  const scheduledAt = scheduledAtSchema.safeParse(rawScheduledAt);
  if (!scheduledAt.success)
    throw new Error(`引数が不正です:\n${z.prettifyError(scheduledAt.error)}`, {
      cause: scheduledAt.error,
    });

  return scheduledAt.data;
}
