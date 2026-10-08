import { crc32, inflateRawSync } from 'node:zlib';

/** End of Central Directory（EOCD）の署名。zip の末尾にあり、中央ディレクトリの位置を持つ */
const EOCD_SIGNATURE = 0x06054b50;
/** EOCD の固定長部分。後ろに最大 65535 バイトのコメントが付きうる */
const EOCD_SIZE = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/**
 * @description zip から指定した名前のファイルを 1 つ取り出す。
 * EDINET コードリストを読むための最小限の実装で、無圧縮と Deflate だけを扱う。
 * ZIP64・暗号化・分割アーカイブは想定した形に読めないので投げる。
 * サイズはデータ記述子を使う zip だとローカルヘッダーで 0 になるため、中央ディレクトリから読む
 */
export function extractZipEntry(zip: Uint8Array, name: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = findEocd(view);
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error(`zip の中央ディレクトリを読めません (offset ${offset})`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const nameStart = offset + CENTRAL_HEADER_SIZE;
    const entryName = new TextDecoder().decode(
      zip.subarray(nameStart, nameStart + nameLength),
    );

    if (entryName === name) {
      return readEntry(zip, view, {
        method: view.getUint16(offset + 10, true),
        crc: view.getUint32(offset + 16, true),
        compressedSize: view.getUint32(offset + 20, true),
        localHeaderOffset: view.getUint32(offset + 42, true),
      });
    }

    offset +=
      CENTRAL_HEADER_SIZE +
      nameLength +
      view.getUint16(offset + 30, true) + // 拡張フィールド長
      view.getUint16(offset + 32, true); // コメント長
  }

  throw new Error(`zip に ${name} がありません`);
}

/** @description コメントの長さが分からないので、末尾から EOCD の署名を探す */
function findEocd(view: DataView): number {
  const last = view.byteLength - EOCD_SIZE;
  const first = Math.max(0, last - MAX_COMMENT_LENGTH);

  for (let offset = last; offset >= first; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('zip の終端レコードが見つかりません');
}

function readEntry(
  zip: Uint8Array,
  view: DataView,
  entry: {
    readonly method: number;
    readonly crc: number;
    readonly compressedSize: number;
    readonly localHeaderOffset: number;
  },
): Uint8Array {
  const { localHeaderOffset: offset } = entry;
  if (view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`zip のローカルヘッダーを読めません (offset ${offset})`);
  }
  // ファイル名と拡張フィールドの長さは中央ディレクトリと食い違うことがあるので、ローカル側の値で飛ばす
  const dataStart =
    offset +
    LOCAL_HEADER_SIZE +
    view.getUint16(offset + 26, true) +
    view.getUint16(offset + 28, true);
  const compressed = zip.subarray(dataStart, dataStart + entry.compressedSize);

  let data: Uint8Array;
  if (entry.method === METHOD_STORED) data = compressed;
  else if (entry.method === METHOD_DEFLATED) data = inflateRawSync(compressed);
  else throw new Error(`zip の圧縮方式 ${entry.method} には対応していません`);

  if (crc32(data) !== entry.crc) {
    throw new Error('zip から取り出したデータの CRC-32 が一致しません');
  }
  return data;
}
