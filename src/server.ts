import { createServer, type ServerResponse } from 'node:http';
import z from 'zod';
import { renderDisclosureHtml } from './presentation/render-disclosure-html.ts';
import fetchWatchlistDisclosure from './usecase/fetch-watchlist-disclosure.ts';
import { toScheduledTime } from './utils.ts';

const HOSTNAME = '127.0.0.1';
const PORT = 8787;
const dateSchema = z.iso
  .date({
    error: 'date は YYYY-MM-DD で指定してください',
  })
  .optional();

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return sendJson(
        res,
        405,
        { error: 'GET のみ受け付けます' },
        { allow: 'GET' },
      );
    }

    const url = new URL(req.url ?? '/', `http://${HOSTNAME}:${PORT}`);

    if (url.pathname === '/health') return sendJson(res, 200, { status: 'ok' });
    if (url.pathname === '/preview') {
      const targetDateParams = url.searchParams.get('date');
      const parsedDate = dateSchema.safeParse(targetDateParams ?? undefined);

      if (!parsedDate.success)
        return sendJson(res, 400, { error: z.prettifyError(parsedDate.error) });

      // 日付を指定したら、その日の定時実行と同じ範囲を見せる。指定が無ければ今この時点で実行した場合の範囲
      const baseTime =
        parsedDate.data === undefined
          ? new Date()
          : toScheduledTime(parsedDate.data);

      const { disclosures, totalCount } =
        await fetchWatchlistDisclosure(baseTime);
      const html = renderDisclosureHtml(disclosures);

      return sendHtml(res, 200, html, {
        'x-total-count': totalCount.toString(),
      });
    }

    return sendJson(res, 404, { error: `${url.pathname} は存在しません` });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error:
        error instanceof Error
          ? error.message
          : '予期しないエラーが発生しました',
    });
  }
});

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  header?: Record<string, string>,
) {
  res.writeHead(statusCode, { ...header, 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendHtml(
  res: ServerResponse,
  statusCode: number,
  html: string,
  header?: Record<string, string>,
) {
  res.writeHead(statusCode, {
    ...header,
    'content-type': 'text/html; charset=utf-8',
  });
  res.end(html);
}

server.listen(PORT, HOSTNAME, () => {
  console.log(`http://${HOSTNAME}:${PORT} で起動中`);
});
