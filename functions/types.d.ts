type R2Object = {
  key: string;
  size: number;
  uploaded?: Date;
  httpEtag: string;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
  writeHttpMetadata(headers: Headers): void;
};

type R2ObjectBody = R2Object & {
  body: ReadableStream;
};

type R2Bucket = {
  list(options?: {
    cursor?: string;
    include?: Array<'httpMetadata' | 'customMetadata'>;
  }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2Object>;
  delete(key: string): Promise<void>;
};
