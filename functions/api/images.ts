type Env = {
  R2_BUCKET: R2Bucket;
  R2_PUBLIC_BASE_URL?: string;
};

type ImageItem = {
  key: string;
  name: string;
  folder: string;
  size: number;
  type: string;
  uploadedAt: string;
  url: string;
};

type FolderItem = {
  name: string;
  imageCount: number;
};

const maxUploadBytes = 25 * 1024 * 1024;
const defaultFolder = '未分類';
const uploadPrefix = 'uploads/';
const folderMarkerPrefix = '.folders/';

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

function getFileNameFromKey(key: string) {
  return key.split('/').pop() || 'image';
}

function sanitizeFolderName(name: string) {
  const folder = name.trim().replace(/[\\/]+/g, '-').replace(/\s{2,}/g, ' ').slice(0, 80);
  return folder || defaultFolder;
}

function folderMarkerKey(folder: string) {
  return `${folderMarkerPrefix}${encodeURIComponent(folder)}.json`;
}

function getFolderFromKey(key: string) {
  if (!key.startsWith(uploadPrefix)) return defaultFolder;

  const rest = key.slice(uploadPrefix.length);
  if (!rest.includes('/')) return defaultFolder;

  return rest.split('/')[0] || defaultFolder;
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
    folder: object.customMetadata?.folder || getFolderFromKey(object.key),
    size: object.size,
    type: object.httpMetadata?.contentType || 'application/octet-stream',
    uploadedAt: object.uploaded?.toISOString() || object.customMetadata?.uploadedAt || new Date().toISOString(),
    url: imageUrl(env, object.key),
  };
}

function buildFolders(objects: R2Object[]) {
  const counts = new Map<string, number>();

  objects.forEach((object) => {
    if (object.key.startsWith(folderMarkerPrefix)) {
      const folder = object.customMetadata?.folder;
      if (folder && !counts.has(folder)) counts.set(folder, 0);
      return;
    }

    if (object.httpMetadata?.contentType?.startsWith('image/')) {
      const folder = object.customMetadata?.folder || getFolderFromKey(object.key);
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  });

  if (!counts.has(defaultFolder)) counts.set(defaultFolder, 0);

  return Array.from(counts.entries())
    .map(([name, imageCount]) => ({ name, imageCount }))
    .sort((first, second) => {
      if (first.name === defaultFolder) return -1;
      if (second.name === defaultFolder) return 1;
      return first.name.localeCompare(second.name, 'zh-Hant');
    });
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

  const images = objects
    .filter((object) => object.httpMetadata?.contentType?.startsWith('image/'))
    .sort((first, second) => {
      const firstTime = first.uploaded?.getTime() ?? 0;
      const secondTime = second.uploaded?.getTime() ?? 0;
      return secondTime - firstTime;
    })
    .map((object) => toImageItem(env, object));

  return {
    folders: buildFolders(objects),
    images,
  };
}

export async function onRequestGet({ env }: { env: Env }) {
  try {
    return json(await listImages(env));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '無法讀取圖片列表' }, 500);
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  try {
    const bucket = getBucket(env);
    const formData = await request.formData();
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);
    const folder = sanitizeFolderName(String(formData.get('folder') || defaultFolder));

    if (files.length === 0) return json({ error: '請選擇至少一張圖片。' }, 400);

    await bucket.put(folderMarkerKey(folder), JSON.stringify({ folder, createdAt: new Date().toISOString() }), {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: {
        folder,
      },
    });

    await Promise.all(
      files.map(async (file) => {
        if (!file.type.startsWith('image/')) {
          throw new Error(`${file.name} 不是支援的圖片格式。`);
        }

        if (file.size > maxUploadBytes) {
          throw new Error(`${file.name} 超過 25 MB 上傳限制。`);
        }

        const safeName = sanitizeFileName(file.name);
        const key = `${uploadPrefix}${folder}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

        await bucket.put(key, file.stream(), {
          httpMetadata: {
            contentType: file.type,
          },
          customMetadata: {
            originalName: file.name,
            folder,
            uploadedAt: new Date().toISOString(),
          },
        });
      }),
    );

    return json(await listImages(env), 201);
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
    return json(await listImages(env));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '刪除圖片失敗' }, 500);
  }
}

export async function onRequestPatch({ request, env }: { request: Request; env: Env }) {
  try {
    const bucket = getBucket(env);
    const payload = (await request.json().catch(() => null)) as {
      folder?: string;
      key?: string;
      keys?: string[];
      targetFolder?: string;
    } | null;

    const moveKeys = Array.from(new Set([...(payload?.keys ?? []), ...(payload?.key ? [payload.key] : [])]));

    if (moveKeys.length > 0 && payload?.targetFolder) {
      const targetFolder = sanitizeFolderName(payload.targetFolder);

      await bucket.put(folderMarkerKey(targetFolder), JSON.stringify({ folder: targetFolder }), {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          folder: targetFolder,
        },
      });

      await Promise.all(
        moveKeys.map(async (key) => {
          const source = await bucket.get(key);

          if (!source) throw new Error(`找不到要移動的圖片：${key}`);

          const originalName =
            source.customMetadata?.originalName || getFileNameFromKey(key).replace(/^\d+-[\w-]+-/, '');
          const destinationKey = `${uploadPrefix}${targetFolder}/${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(
            originalName,
          )}`;

          await bucket.put(destinationKey, source.body, {
            httpMetadata: {
              contentType: source.httpMetadata?.contentType,
            },
            customMetadata: {
              ...source.customMetadata,
              originalName,
              folder: targetFolder,
              movedAt: new Date().toISOString(),
            },
          });
          await bucket.delete(key);
        }),
      );

      return json(await listImages(env));
    }

    const folder = sanitizeFolderName(payload?.folder || '');

    await bucket.put(folderMarkerKey(folder), JSON.stringify({ folder, createdAt: new Date().toISOString() }), {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: {
        folder,
      },
    });

    return json(await listImages(env), 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '建立資料夾失敗' }, 500);
  }
}
