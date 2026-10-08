/** 文字から Shift_JIS の 2 バイトへの対応。初回の呼び出しで作る */
let doubleByteTable: Map<string, readonly [number, number]> | undefined;

/**
 * @description Node には Shift_JIS のエンコーダーが無いので、デコーダーに 2 バイトの組を総当たりで渡して対応を作る。
 * 同じ文字に複数の組が対応する機種依存文字は、先に見つかった組を使う
 */
function buildDoubleByteTable(): Map<string, readonly [number, number]> {
  const decoder = new TextDecoder('shift_jis');
  const table = new Map<string, readonly [number, number]>();

  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead >= 0xa0 && lead <= 0xdf) continue; // 半角カナの 1 バイト領域
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const char = decoder.decode(new Uint8Array([lead, trail]));
      if (char.length === 1 && char !== '�' && !table.has(char)) {
        table.set(char, [lead, trail]);
      }
    }
  }

  return table;
}

/**
 * @description テスト用に、文字列を Shift_JIS のバイト列にする。ASCII と全角文字だけを扱い、半角カナは扱わない
 */
export function encodeShiftJis(text: string): Uint8Array {
  doubleByteTable ??= buildDoubleByteTable();
  const bytes: number[] = [];

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
      continue;
    }

    const pair = doubleByteTable.get(char);
    if (pair === undefined) {
      throw new Error(`Shift_JIS で表せない文字です: ${char}`);
    }
    bytes.push(...pair);
  }

  return Uint8Array.from(bytes);
}
