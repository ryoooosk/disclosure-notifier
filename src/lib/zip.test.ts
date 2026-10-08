import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildZip } from '../testing/build-zip.ts';
import { extractZipEntry } from './zip.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('extractZipEntry', () => {
  test('Deflate で格納されたファイルを展開する', () => {
    const zip = buildZip({ 'list.csv': encode('a,b\r\n1,2\r\n') });

    assert.equal(decode(extractZipEntry(zip, 'list.csv')), 'a,b\r\n1,2\r\n');
  });

  test('無圧縮で格納されたファイルをそのまま取り出す', () => {
    const zip = buildZip({ 'list.csv': encode('a,b') }, { method: 'stored' });

    assert.equal(decode(extractZipEntry(zip, 'list.csv')), 'a,b');
  });

  test('複数のファイルから名前の一致するものを取り出す', () => {
    const zip = buildZip({
      'readme.txt': encode('readme'),
      'list.csv': encode('list'),
    });

    assert.equal(decode(extractZipEntry(zip, 'list.csv')), 'list');
  });

  test('末尾にコメントが付いていても終端レコードを見つける', () => {
    const zip = buildZip({ 'list.csv': encode('list') });
    const comment = encode('generated');
    const withComment = new Uint8Array(zip.length + comment.length);
    withComment.set(zip);
    withComment.set(comment, zip.length);
    // 終端レコードのコメント長を書き換える
    new DataView(withComment.buffer).setUint16(
      zip.length - 2,
      comment.length,
      true,
    );

    assert.equal(decode(extractZipEntry(withComment, 'list.csv')), 'list');
  });

  test('名前の一致するファイルが無ければ投げる', () => {
    const zip = buildZip({ 'other.csv': encode('other') });

    assert.throws(
      () => extractZipEntry(zip, 'list.csv'),
      /list\.csv がありません/,
    );
  });

  test('中身が壊れていて CRC-32 が合わなければ投げる', () => {
    const zip = buildZip(
      { 'list.csv': encode('abcdef') },
      { method: 'stored' },
    );
    // ローカルヘッダー（30 バイト）とファイル名（8 バイト）の直後が中身
    zip[38] = 'z'.charCodeAt(0);

    assert.throws(() => extractZipEntry(zip, 'list.csv'), /CRC-32/);
  });

  test('zip でないデータは投げる', () => {
    assert.throws(
      () => extractZipEntry(encode('<html>Sorry</html>'), 'list.csv'),
      /終端レコードが見つかりません/,
    );
  });
});
