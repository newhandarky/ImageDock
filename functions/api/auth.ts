import { clearSessionCookie, createSessionCookie } from '../_auth';

type Env = {
  ADMIN_PASSWORD?: string;
  AUTH_SECRET?: string;
};

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  if (!env.ADMIN_PASSWORD) {
    return Response.json({ error: 'ADMIN_PASSWORD 尚未設定。' }, { status: 500 });
  }

  const payload = (await request.json().catch(() => null)) as { password?: string } | null;
  if (payload?.password !== env.ADMIN_PASSWORD) {
    return Response.json({ error: '管理密碼不正確。' }, { status: 401 });
  }

  const sessionCookie = await createSessionCookie(env);
  return Response.json(
    { authenticated: true },
    {
      headers: {
        'set-cookie': sessionCookie,
      },
    },
  );
}

export function onRequestDelete() {
  return Response.json(
    { authenticated: false },
    {
      headers: {
        'set-cookie': clearSessionCookie(),
      },
    },
  );
}
