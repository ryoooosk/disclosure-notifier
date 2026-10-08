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
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);

    if (quoted) {
      if (c !== '"') field += c;
      // 囲みの中の "" は " 1 文字を表す
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }

  // 末尾が改行で終わっていない場合の最終行
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
