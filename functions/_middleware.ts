import { isAuthenticated } from './_auth';

type Env = {
  ADMIN_PASSWORD?: string;
  AUTH_SECRET?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
  next(): Promise<Response>;
};

export async function onRequest({ request, env, next }: PagesContext) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api/')) return next();
  if (url.pathname === '/api/auth' || url.pathname === '/api/session') return next();

  if (await isAuthenticated(request, env)) return next();

  return Response.json({ error: '未登入，請先輸入管理密碼。' }, { status: 401 });
}
