import { requestEdinetCodeList } from './edinet-api.ts';

/** EDINET コードに紐づく提出者。大量保有報告書の発行会社を証券コードと社名に直すのに使う */
export interface EdinetFiler {
  readonly name: string;
  /** 4 文字の証券コード。非上場の提出者では null */
  readonly code: string | null;
}

/** 5 桁コード（4 桁コード + 末尾 0）。`409A0` のように英字を含むものが実在する */
const CODE_PATTERN = /^[0-9A-Z]{5}$/;

/** 読む列の見出し。並びが変わっても読めるよう、位置ではなく見出しで探す */
const COLUMN = {
  edinetCode: 'ＥＤＩＮＥＴコード',
  name: '提出者名',
  code: '証券コード',
} as const;

/**
 * @description EDINET コードリストを取得し、EDINET コードから提出者を引けるようにする。
 * 1 行目は件数などのメタ情報、2 行目が見出しで、データは 3 行目から始まる。
 * 見出しが読めない場合は、配布形式が変わったとみなして投げる
 */
export async function fetchEdinetCodeList(): Promise<
  ReadonlyMap<string, EdinetFiler>
> {
  const [, header, ...records] = parseCsv(await requestEdinetCodeList());
  if (header === undefined) {
    throw new Error('EDINET コードリストに見出しの行がありません');
  }

  const columnIndex = (column: string) => {
    const index = header.indexOf(column);
    if (index === -1) {
      throw new Error(`EDINET コードリストに「${column}」の列がありません`);
    }
    return index;
  };
  const edinetCodeIndex = columnIndex(COLUMN.edinetCode);
  const nameIndex = columnIndex(COLUMN.name);
  const codeIndex = columnIndex(COLUMN.code);

  const filers = new Map<string, EdinetFiler>();
  for (const record of records) {
    const edinetCode = record[edinetCodeIndex];
    if (!edinetCode) continue;

    const rawCode = record[codeIndex] ?? '';
    filers.set(edinetCode, {
      name: record[nameIndex] ?? '',
      // TDnet と同じく 4 桁コードの末尾に 0 を足した 5 桁で載っているので 4 桁に戻す。非上場は空欄
      code: CODE_PATTERN.test(rawCode) ? rawCode.slice(0, 4) : null,
    });
  }

  return filers;
}

/**
 * @description RFC 4180 形式の CSV を行と列に分ける。
 * 社名の英字表記などにカンマを含む値があり、値は "" で囲まれているので、split では切れない
 */
function parseCsv(text: string): string[][] {
  if (text === '') return [];
  // g や y の正規表現は lastIndex を持つので、モジュールで共有せず呼び出しごとに作る
  /** 1 行分。"" の囲みの中の改行では切らない */
  const ROW = /((?:"(?:[^"]|"")*"|[^"\r\n])*)\r?\n/gy;
  /** 1 つの値と後ろのカンマ。"" の囲みの中のカンマでは切らない */
  const FIELD = /(?:"((?:[^"]|"")*)"|([^",]*)),/gy;

  // どちらの正規表現も区切りまでを 1 回の一致とするので、最終行の改行と最終列のカンマを補う
  const lines = text.endsWith('\n') ? text : `${text}\n`;
  return lines
    .matchAll(ROW)
    .map(([, line = '']) =>
      `${line},`
        .matchAll(FIELD)
        .map(([, quoted, plain = '']) =>
          // 囲みの中の "" は " 1 文字を表す
          quoted === undefined ? plain : quoted.replaceAll('""', '"'),
        )
        .toArray(),
    )
    .toArray();
}
