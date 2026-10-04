import { parseBaseTime } from './config/base-time.ts';
import { sendMail } from './lib/resend.ts';
import {
  renderDisclosureHtml,
  renderDisclosureText,
} from './presentation/render-disclosure-html.ts';
import fetchWatchlistDisclosure from './usecase/fetch-watchlist-disclosure.ts';
import { toJstDate } from './utils.ts';

async function main() {
  const baseTime = parseBaseTime(process.argv.slice(2));
  const date = toJstDate(baseTime);
  console.log(
    `基準時刻 ${baseTime.toISOString()} で ${date} の開示を確認します`,
  );

  const { disclosures: targetDisclosures } =
    await fetchWatchlistDisclosure(baseTime);

  if (targetDisclosures.length === 0) {
    console.log(`${date} はウォッチリストの開示がありません。送信を見送ります`);
    return;
  }

  const sent = await sendMail({
    subject: `${date} の開示`,
    html: renderDisclosureHtml(targetDisclosures),
    text: renderDisclosureText(targetDisclosures),
  });

  console.log(`メールを送信しました (id: ${sent?.id})`);
}

await main();
