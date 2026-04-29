type Env = {
  R2_BUCKET: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  CLOUDFLARE_API_TOKEN?: string;
};

type OperationGroup = {
  sum?: {
    requests?: number;
  };
  dimensions?: {
    actionType?: string;
  };
};

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function listCurrentBucketUsage(bucket: R2Bucket) {
  let objectCount = 0;
  let payloadSize = 0;
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ cursor });
    objectCount += page.objects.length;
    payloadSize += page.objects.reduce((sum, object) => sum + object.size, 0);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return {
    objectCount,
    payloadSize,
  };
}

async function fetchAccountMetrics(env: Env) {
  if (!env.R2_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return null;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.R2_ACCOUNT_ID}/r2/metrics`,
    {
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      },
    },
  );

  if (!response.ok) return null;

  return (await response.json()) as {
    result?: {
      standard?: {
        published?: {
          metadataSize?: number;
          objects?: number;
          payloadSize?: number;
        };
      };
    };
  };
}

async function fetchOperations(env: Env) {
  if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET_NAME || !env.CLOUDFLARE_API_TOKEN) return [];

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
  const query = `
    query R2VolumeExample($accountTag: string!, $startDate: Time, $endDate: Time, $bucketName: string) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: {
              datetime_geq: $startDate
              datetime_leq: $endDate
              bucketName: $bucketName
            }
          ) {
            sum {
              requests
            }
            dimensions {
              actionType
            }
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: env.R2_ACCOUNT_ID,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        bucketName: env.R2_BUCKET_NAME,
      },
    }),
  });

  if (!response.ok) return [];

  const payload = (await response.json()) as {
    data?: {
      viewer?: {
        accounts?: Array<{
          r2OperationsAdaptiveGroups?: OperationGroup[];
        }>;
      };
    };
  };

  return (
    payload.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups
      ?.map((group) => ({
        actionType: group.dimensions?.actionType || 'unknown',
        requests: group.sum?.requests || 0,
      }))
      .sort((first, second) => second.requests - first.requests) ?? []
  );
}

export async function onRequestGet({ env }: { env: Env }) {
  try {
    if (!env.R2_BUCKET) {
      return json({ error: 'Cloudflare Pages 尚未綁定 R2_BUCKET。' }, 500);
    }

    const [currentUsage, accountMetrics, operations] = await Promise.all([
      listCurrentBucketUsage(env.R2_BUCKET),
      fetchAccountMetrics(env),
      fetchOperations(env),
    ]);

    const published = accountMetrics?.result?.standard?.published;
    const requestsLast24h = operations.reduce((sum, operation) => sum + operation.requests, 0);

    return json({
      usage: {
        objectCount: published?.objects ?? currentUsage.objectCount,
        payloadSize: published?.payloadSize ?? currentUsage.payloadSize,
        metadataSize: published?.metadataSize ?? 0,
        requestsLast24h,
        operations,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '無法讀取 R2 使用量' }, 500);
  }
}
