import { isAuthenticated } from '../_auth';

type Env = {
  ADMIN_PASSWORD?: string;
  AUTH_SECRET?: string;
};

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  return Response.json({
    authenticated: await isAuthenticated(request, env),
  });
}
