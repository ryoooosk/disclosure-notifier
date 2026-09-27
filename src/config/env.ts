import z from 'zod';

const envSchema = z.object({
  RESEND_API_KEY: z.string().min(1, { error: 'Resend の API キーが空です。' }),
  EMAIL_FROM: z.email({ error: '送信元メールアドレスが不正です。' }),
  EMAIL_TO: z.email({ error: '送信先メールアドレスが不正です' }),
  EDINET_DB_API_KEY: z
    .string()
    .min(1, { error: 'Edinet DB の APIキーが空です。' }),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const env = envSchema.safeParse(process.env);
  if (!env.success)
    throw new Error(`環境変数が不正です:\n${z.prettifyError(env.error)}`, {
      cause: env.error,
    });

  return env.data;
}
