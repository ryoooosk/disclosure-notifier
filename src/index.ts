import { sendMail } from './lib/resend.ts';
import {
  renderDisclosureHtml,
  renderDisclosureText,
} from './presentation/render-disclosure-html.ts';
import fetchWatchlistDisclosure from './usecase/fetch-watchlist-disclosure.ts';
import { getToday } from './utils.ts';

async function main() {
  const today = getToday();

  const { disclosures: targetDisclosures } =
    await fetchWatchlistDisclosure(today);

  if (targetDisclosures.length === 0) {
    console.log(
      `${today} はウォッチリストの開示がありません。送信を見送ります`,
    );
    return;
  }

  const sent = await sendMail({
    subject: `${today} の開示`,
    html: renderDisclosureHtml(targetDisclosures),
    text: renderDisclosureText(targetDisclosures),
  });

  console.log(`メールを送信しました (id: ${sent?.id})`);
}

await main();
