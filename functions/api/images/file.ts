type Env = {
  R2_BUCKET: R2Bucket;
};

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  if (!env.R2_BUCKET) {
    return Response.json({ error: 'Cloudflare Pages 尚未綁定 R2_BUCKET。' }, { status: 500 });
  }

  const key = new URL(request.url).searchParams.get('key');
  if (!key) return Response.json({ error: '缺少圖片 key。' }, { status: 400 });

  const object = await env.R2_BUCKET.get(key);
  if (!object) return Response.json({ error: '找不到圖片。' }, { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
}
