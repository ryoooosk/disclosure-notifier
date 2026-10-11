import z from 'zod';
import type { Disclosure, DisclosureKind } from '../../model/disclosure.ts';
import { toJstDate } from '../../utils.ts';
import {
  type EdinetDocTypeCode,
  edinetDocTypeCode,
  edinetDocumentPdfUrl,
  requestEdinetDocuments,
} from './edinet-api.ts';
import { type EdinetFiler, fetchEdinetCodeList } from './fetch-code-list.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 5 桁コード（4 桁コード + 末尾 0）。`409A0` のように英字を含むものが実在する */
const CODE_PATTERN = /^[0-9A-Z]{5}$/;
/** 提出日時。JST だがタイムゾーンは書かれない */
const SUBMIT_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * 通知する書類種別と開示種別の対応。ここに無い種別は通知しない。
 * 臨時報告書や公開買付届出書は、同じ事柄の適時開示が TDnet にも出て二重に届くので持たない
 */
const KIND_BY_DOC_TYPE: Readonly<Record<EdinetDocTypeCode, DisclosureKind>> = {
  [edinetDocTypeCode.annualReport]: 'annualReport',
  [edinetDocTypeCode.annualReportCorrection]: 'annualReport',
  [edinetDocTypeCode.semiAnnualReport]: 'semiAnnualReport',
  [edinetDocTypeCode.largeHoldingReport]: 'largeHolding',
};

/**
 * @description KIND_BY_DOC_TYPE に載っている種別かを判定する。
 * in ではなく hasOwn で見るのは、constructor などプロトタイプ由来のキーを弾くため
 */
function isTargetDocType(code: string): code is EdinetDocTypeCode {
  return Object.hasOwn(KIND_BY_DOC_TYPE, code);
}

/**
 * 提出書類 1 件。Disclosure に載る値と、通知するかの判定に使う値だけを持つ。
 * 閲覧期間を過ぎた書類は docID 以外が null になるため、文字列の項目は null を許す
 */
const edinetDocument = z.object({
  /** 書類管理番号。開示の一意キーになり、PDF の URL もこれで組む */
  docID: z.string(),
  /** 提出者の証券コード（5 桁）。大量保有報告書では保有者のもので、発行会社のものではない */
  secCode: z.string().nullable(),
  filerName: z.string().nullable(),
  docTypeCode: z.string().nullable(),
  /** 提出日時（JST, `YYYY-MM-DD hh:mm`） */
  submitDateTime: z.string().nullable(),
  /** 閲覧サイトの「提出書類」欄に出る文字列。メール本文の表題に使う */
  docDescription: z.string().nullable(),
  /** 大量保有報告書の発行会社の EDINET コード */
  issuerEdinetCode: z.string().nullable(),
  /** 取下書は "1"、取り下げられた書類は "2"、それ以外は "0" */
  withdrawalStatus: z.string(),
  /** 財務局職員による修正の記録は "1"、修正された書類は "2"、それ以外は "0" */
  docInfoEditStatus: z.string(),
  /** 不開示の開始・解除の記録と、不開示中の書類は "0" 以外 */
  disclosureStatus: z.string(),
  /** 閲覧サイトで PDF を表示できる書類は "1" */
  pdfFlag: z.string(),
});
type EdinetDocument = z.infer<typeof edinetDocument>;

/**
 * 書類一覧のレスポンス。パラメータの誤りなどは HTTP 200 のまま metadata.status に出て、
 * そのときは results ごと無い
 */
const edinetDocumentListResponse = z.object({
  metadata: z.object({ status: z.string(), message: z.string() }),
  results: z.array(z.unknown()).optional(),
});

/** 想定した形に読めず捨てた書類。ログに出して EDINET 側の変化に気づくために持つ */
interface SkippedDocument {
  /** 書類一覧のファイル日付（JST, YYYY-MM-DD） */
  readonly date: string;
  /** その日の書類一覧での位置 */
  readonly index: number;
  readonly reason: string;
  readonly raw: unknown;
}

interface FetchEdinetDocumentsParams {
  /** この時刻以降に提出されたものを返す */
  readonly submittedSince: Date;
  /** この時刻より前に提出されたものを返す。submittedSince と合わせて [since, before) の半開区間になる */
  readonly submittedBefore: Date;
}

/** 取得範囲の書類一覧を読み切った結果 */
interface EdinetDocuments {
  readonly disclosures: readonly Disclosure[];
  /**
   * 取得範囲に提出された、通知する種別の書類の件数。投資信託など証券コードを持たない提出者や
   * 読めずに捨てた書類も含むため、disclosures.length より大きくなるのが普通
   */
  readonly totalCount: number;
  readonly skippedDocuments: readonly SkippedDocument[];
}

/** 1 件を読んだ結果。捨てた理由と、対象外なだけの場合を区別する */
type ReadResult =
  | { readonly status: 'ok'; readonly disclosure: Disclosure }
  | { readonly status: 'skipped'; readonly reason: string }
  /** 証券コードを持たない会社の書類。異常ではないので skippedDocuments には積まない */
  | { readonly status: 'notListed' }
  /** 通知しない種別、取り下げ・不開示、取得範囲外のもの。件数にも数えない */
  | { readonly status: 'outOfScope' };

/** 開示の対象になった会社と、その会社の開示として見せる表題 */
type Subject =
  | {
      readonly status: 'ok';
      readonly code: string;
      readonly companyName: string;
      readonly title: string;
    }
  | Extract<ReadResult, { status: 'skipped' | 'notListed' }>;

/**
 * @description 取得範囲に提出された書類を、範囲にかかる日の書類一覧から集め、Disclosure に変換する。
 * 読めなかった書類は捨てて skippedDocuments に積み、呼び出し側がログに出して気づけるようにする。
 * 書類一覧の外枠が読めない場合と、EDINET がエラーを返した場合は投げる。
 */
export async function fetchEdinetDocuments(
  params: FetchEdinetDocumentsParams,
): Promise<EdinetDocuments> {
  const disclosures: Disclosure[] = [];
  const skippedDocuments: SkippedDocument[] = [];
  let totalCount = 0;

  // 発行会社を引くコードリストは zip で 600KB 近くあるので、大量保有報告書が出てきたときに 1 回だけ取る
  let filers: Promise<ReadonlyMap<string, EdinetFiler>> | undefined;
  const getFilers = () => {
    filers ??= fetchEdinetCodeList();
    return filers;
  };

  for (const date of fileDates(params)) {
    const results = await fetchDocumentList(date);

    for (const [index, raw] of results.entries()) {
      const read = await readDocument(raw, params, getFilers);
      if (read.status === 'outOfScope') continue;

      totalCount++;
      if (read.status === 'notListed') continue;
      if (read.status === 'skipped') {
        skippedDocuments.push({ date, index, reason: read.reason, raw });
        continue;
      }

      disclosures.push(read.disclosure);
    }
  }

  return { disclosures, totalCount, skippedDocuments };
}

/**
 * @description 取得範囲にかかるファイル日付（JST）を古い順に返す。
 * 書類一覧は提出処理された日ごとにしか取れないので、範囲の両端の日を含めて全部引く
 */
function fileDates({
  submittedSince,
  submittedBefore,
}: FetchEdinetDocumentsParams): string[] {
  // 上限は含まないので、上限がちょうど JST 0 時ならその日の一覧は要らない
  const lastDate = toJstDate(new Date(submittedBefore.getTime() - 1));
  const dates: string[] = [];

  // JST に夏時間は無いので、24 時間ずつ進めれば日付も 1 日ずつ進む
  for (let time = submittedSince.getTime(); ; time += DAY_MS) {
    const date = toJstDate(new Date(time));
    dates.push(date);
    if (date >= lastDate) break;
  }

  return dates;
}

async function fetchDocumentList(date: string): Promise<unknown[]> {
  const response = edinetDocumentListResponse.parse(
    await requestEdinetDocuments(date),
  );
  const { status, message } = response.metadata;

  if (status !== '200' || response.results === undefined) {
    throw new Error(
      `EDINET の書類一覧を取得できませんでした (status ${status}: ${message}, date=${date})`,
    );
  }

  return response.results;
}

/** @description 書類 1 件を読み、通知する開示に変換できるかを判定する */
async function readDocument(
  raw: unknown,
  range: FetchEdinetDocumentsParams,
  getFilers: () => Promise<ReadonlyMap<string, EdinetFiler>>,
): Promise<ReadResult> {
  const parsed = edinetDocument.safeParse(raw);
  if (!parsed.success) {
    return { status: 'skipped', reason: z.prettifyError(parsed.error) };
  }
  const document = parsed.data;

  if (document.docTypeCode === null || !isTargetDocType(document.docTypeCode)) {
    return { status: 'outOfScope' };
  }
  // 取り下げ・不開示になった書類と、財務局職員が書類を修正したという記録の行は開示として扱わない
  if (
    document.withdrawalStatus !== '0' ||
    document.disclosureStatus !== '0' ||
    document.docInfoEditStatus === '1'
  ) {
    return { status: 'outOfScope' };
  }

  const submittedAt = parseSubmitDateTime(document.submitDateTime);
  if (submittedAt === null) {
    return {
      status: 'skipped',
      reason: `提出日時を解釈できませんでした: ${JSON.stringify(document.submitDateTime)}`,
    };
  }
  if (
    submittedAt.getTime() < range.submittedSince.getTime() ||
    submittedAt.getTime() >= range.submittedBefore.getTime()
  ) {
    return { status: 'outOfScope' };
  }

  if (!document.docDescription) {
    return { status: 'skipped', reason: '提出書類概要が空です' };
  }

  const kind = KIND_BY_DOC_TYPE[document.docTypeCode];
  const subject =
    kind === 'largeHolding'
      ? readIssuer(document, document.docDescription, await getFilers())
      : readFiler(document, document.docDescription);
  if (subject.status !== 'ok') return subject;

  return {
    status: 'ok',
    disclosure: {
      source: 'edinet',
      originalId: document.docID,
      code: subject.code,
      companyName: subject.companyName,
      title: subject.title,
      kind,
      documentUrl:
        document.pdfFlag === '1' ? edinetDocumentPdfUrl(document.docID) : null,
      disclosedAt: submittedAt.toISOString(),
    },
  };
}

/** @description 有報・半期報告書は提出者自身の開示なので、提出者の証券コードで照合する */
function readFiler(document: EdinetDocument, description: string): Subject {
  // 投資信託の受益証券など、ウォッチリストと照合しようがない提出者の書類
  if (document.secCode === null) return { status: 'notListed' };
  if (!CODE_PATTERN.test(document.secCode)) {
    return {
      status: 'skipped',
      reason: `証券コードが 5 桁ではありません: ${JSON.stringify(document.secCode)}`,
    };
  }
  if (!document.filerName)
    return { status: 'skipped', reason: '提出者名が空です' };

  return {
    status: 'ok',
    // TDnet と同じく 4 桁コードの末尾に 0 を足した 5 桁で返るので 4 桁に戻す
    code: document.secCode.slice(0, 4),
    companyName: document.filerName,
    title: description,
  };
}

/**
 * @description 大量保有報告書の提出者は保有者側なので、発行会社の EDINET コードを
 * コードリストで証券コードと社名に直して照合する。保有者は表題に添える
 */
function readIssuer(
  document: EdinetDocument,
  description: string,
  filers: ReadonlyMap<string, EdinetFiler>,
): Subject {
  if (document.issuerEdinetCode === null) {
    return { status: 'skipped', reason: '発行会社の EDINET コードが空です' };
  }
  const issuer = filers.get(document.issuerEdinetCode);
  if (issuer === undefined) {
    return {
      status: 'skipped',
      reason: `EDINET コードリストに発行会社 ${document.issuerEdinetCode} がありません`,
    };
  }
  if (issuer.code === null) return { status: 'notListed' };

  return {
    status: 'ok',
    code: issuer.code,
    companyName: issuer.name,
    title: document.filerName
      ? `${description}（提出者: ${document.filerName}）`
      : description,
  };
}

/**
 * @description 提出日時を Date にする。EDINET は時刻にタイムゾーンを書かないため、JST であることはここで補う。
 * 付けずに `new Date()` へ渡すと実行環境のタイムゾーンで解釈され、UTC で動く GitHub Actions 上だけ 9 時間ずれる
 */
function parseSubmitDateTime(raw: string | null): Date | null {
  if (raw === null || !SUBMIT_DATE_TIME_PATTERN.test(raw)) return null;

  const parsed = new Date(`${raw.replace(' ', 'T')}:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
