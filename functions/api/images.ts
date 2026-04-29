type Env = {
  R2_BUCKET: R2Bucket;
  R2_PUBLIC_BASE_URL?: string;
};

type ImageItem = {
  key: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  url: string;
};

const maxUploadBytes = 25 * 1024 * 1024;

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

function getBucket(env: Env) {
  if (!env.R2_BUCKET) {
    throw new Error('Cloudflare Pages 尚未綁定 R2_BUCKET。');
  }

  return env.R2_BUCKET;
}

function sanitizeFileName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'image';
}

function encodeKeyPath(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function imageUrl(env: Env, key: string) {
  const baseUrl = env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '');
  return baseUrl ? `${baseUrl}/${encodeKeyPath(key)}` : `/api/images/file?key=${encodeURIComponent(key)}`;
}

function toImageItem(env: Env, object: R2Object): ImageItem {
  return {
    key: object.key,
    name: object.customMetadata?.originalName || object.key.split('/').pop() || object.key,
    size: object.size,
    type: object.httpMetadata?.contentType || 'application/octet-stream',
    uploadedAt: object.uploaded?.toISOString() || object.customMetadata?.uploadedAt || new Date().toISOString(),
    url: imageUrl(env, object.key),
  };
}

async function listImages(env: Env) {
  const bucket = getBucket(env);
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({
      cursor,
      include: ['httpMetadata', 'customMetadata'],
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return objects
    .filter((object) => object.httpMetadata?.contentType?.startsWith('image/'))
    .sort((first, second) => {
      const firstTime = first.uploaded?.getTime() ?? 0;
      const secondTime = second.uploaded?.getTime() ?? 0;
      return secondTime - firstTime;
    })
    .map((object) => toImageItem(env, object));
}

export async function onRequestGet({ env }: { env: Env }) {
  try {
    const images = await listImages(env);
    return json({ images });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '無法讀取圖片列表' }, 500);
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  try {
    const bucket = getBucket(env);
    const formData = await request.formData();
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);

    if (files.length === 0) return json({ error: '請選擇至少一張圖片。' }, 400);

    await Promise.all(
      files.map(async (file) => {
        if (!file.type.startsWith('image/')) {
          throw new Error(`${file.name} 不是支援的圖片格式。`);
        }

        if (file.size > maxUploadBytes) {
          throw new Error(`${file.name} 超過 25 MB 上傳限制。`);
        }

        const safeName = sanitizeFileName(file.name);
        const key = `uploads/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

        await bucket.put(key, file.stream(), {
          httpMetadata: {
            contentType: file.type,
          },
          customMetadata: {
            originalName: file.name,
            uploadedAt: new Date().toISOString(),
          },
        });
      }),
    );

    const images = await listImages(env);
    return json({ images }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '上傳圖片失敗' }, 500);
  }
}

export async function onRequestDelete({ request, env }: { request: Request; env: Env }) {
  try {
    const bucket = getBucket(env);
    const key = new URL(request.url).searchParams.get('key');

    if (!key) return json({ error: '缺少要刪除的圖片 key。' }, 400);

    await bucket.delete(key);
    const images = await listImages(env);
    return json({ images });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '刪除圖片失敗' }, 500);
  }
}
