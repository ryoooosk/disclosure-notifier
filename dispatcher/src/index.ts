const REPO = 'ryoooosk/disclosure-notifier';
const WORKFLOW = 'disclosure-notifier.yml';
const MAX_ATTEMPTS = 3;

class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`GitHub API が ${status} を返しました: ${body}`);
    this.status = status;
  }
}

export default {
  async scheduled(controller, env) {
    // 予定時刻を基準時刻として渡す。起動が多少ずれても対象日は変わらない
    const scheduledAt = new Date(controller.scheduledTime).toISOString();

    try {
      await dispatchWithRetry(env, scheduledAt);
      console.log(
        `workflow_dispatch を送りました (scheduled_at: ${scheduledAt})`,
      );
    } catch (error) {
      console.error(error);
      // 通知は自前で送るので、Cloudflare 側の再実行で二重に起動・通知しないようにする
      controller.noRetry();
      await notifyFailure(env, scheduledAt, error).catch((notifyError) =>
        console.error('失敗通知も送れませんでした', notifyError),
      );
      // 投げ直して Past Cron Events に失敗として残す
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;

async function dispatchWithRetry(env: Env, scheduledAt: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await dispatch(env, scheduledAt);
    } catch (error) {
      // 4xx（トークン失効・入力の不一致など）は何度送っても同じなので諦める
      const retryable =
        !(error instanceof GitHubApiError) ||
        error.status === 429 ||
        error.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;

      // 2 秒、4 秒と待つ。待ち時間は CPU 時間に数えられない
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
}

async function dispatch(env: Env, scheduledAt: string) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        // GitHub API は User-Agent の無いリクエストを拒否する
        'User-Agent': 'disclosure-dispatcher',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { scheduled_at: scheduledAt },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new GitHubApiError(res.status, await res.text());
}

async function notifyFailure(env: Env, scheduledAt: string, error: unknown) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [env.EMAIL_TO],
      subject: 'disclosure-notifier を起動できませんでした',
      text: [
        'Cloudflare Workers から GitHub Actions を起動できませんでした。今回の開示は通知されていません。',
        '',
        `予定時刻: ${scheduledAt}`,
        `エラー: ${error instanceof Error ? error.message : String(error)}`,
        '',
        '手動で起動するには:',
        `gh workflow run ${WORKFLOW} -R ${REPO} -f scheduled_at=${scheduledAt}`,
      ].join('\n'),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok)
    throw new Error(
      `Resend が ${res.status} を返しました: ${await res.text()}`,
    );
}
