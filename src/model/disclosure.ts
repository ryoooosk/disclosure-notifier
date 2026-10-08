import z from 'zod';

/**
 * 開示の取得元。originalId の ID 空間がソースごとに違う。
 */
const disclosureSource = ['tdnet', 'edinet'] as const;

/**
 * 開示の種別。TDnet の一覧に種別カラムは無いため、表題の文字列から判定する。
 * 実データ 300 件の表題を分類。
 *
 * 並び順は株価インパクトの大きい順。1 つの開示が `〜及び〜` で複数の事象を
 * 兼ねることがあるため、判定は上から順に最初に一致したものを採る想定。
 */
const disclosureKind = [
  /** 業績予想の修正、業績予想と実績値との差異 */
  'guidanceRevision',
  /** 特別損失・減損損失の計上 */
  'specialLoss',
  /** 公開買付け（TOB / MBO）、意見表明、買付結果 */
  'tenderOffer',
  /** 大量保有報告書、変更報告書。TDnet には出ないので EDINET 由来のみ */
  'largeHolding',
  /** 合併、株式交換、株式移転、会社分割 */
  'merger',
  /** 子会社・関係会社の異動、設立、譲渡、組織再編 */
  'subsidiary',
  /** 業務提携、資本業務提携 */
  'alliance',
  /** 第三者割当、新株式発行、新株予約権付社債（希薄化を伴う資金調達） */
  'equityFinance',
  /** 上場廃止、監理銘柄・特設注意市場銘柄の指定 */
  'listingStatus',
  /** 剰余金の配当、配当予想の修正 */
  'dividend',
  /** 自己株式の取得・取得状況・ToSTNeT-3 による買付け */
  'buyback',
  /** 決算短信（四半期・通期） */
  'earnings',
  /** 決算説明資料、想定質問と回答、説明会資料。短信と同時に出る補足資料 */
  'earningsMaterial',
  /** 有価証券報告書、訂正有価証券報告書。短信の後に出るため新規の情報は少ない */
  'annualReport',
  /** 半期報告書。2024 年の四半期報告書廃止で新設された法定開示 */
  'semiAnnualReport',
  /** 月次売上高、月次実績の開示 */
  'monthlyReport',
  /** 中期経営計画の策定・変更 */
  'midTermPlan',
  /** 資金の借入、社債発行など希薄化を伴わない資金調達 */
  'financing',
  /** 株主優待制度の新設・変更・廃止 */
  'shareholderBenefit',
  /** 新株予約権、ストック・オプション、譲渡制限付株式の発行 */
  'stockCompensation',
  /** 役員の異動、代表取締役の異動、人事 */
  'personnel',
  /** 株主総会の招集、定款の変更、コーポレート・ガバナンス報告書 */
  'governance',
  /** 上記のいずれにも当てはまらないもの。分類できないのは異常ではない */
  'other',
] as const;

export type DisclosureKind = (typeof disclosureKind)[number];

/**
 * 証券コード。英字を含むものは大文字が正準形（TDnet も大文字で返す）。
 * 手書きの設定ファイルから来る値は小文字で書かれうるため、ここで揃えておく。
 */
export const securitiesCode = z
  .string()
  .regex(/^[a-zA-Z0-9]{4}$/, { error: '証券コードは半角英数字4文字です' })
  .transform((code) => code.toUpperCase());

export const disclosure = z.object({
  source: z.enum(disclosureSource),
  originalId: z.string(),
  code: securitiesCode,
  companyName: z.string(),
  title: z.string(),
  kind: z.enum(disclosureKind),
  /** 開示文書の URL。EDINET の書類は PDF が無いものだけ null */
  documentUrl: z.string().nullable(),
  disclosedAt: z.iso.datetime(),
});

export type Disclosure = z.infer<typeof disclosure>;
