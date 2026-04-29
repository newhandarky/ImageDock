import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Cloud,
  Copy,
  Folder,
  FolderPlus,
  ImagePlus,
  Images,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';

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

type UsageSummary = {
  objectCount: number;
  payloadSize: number;
  metadataSize: number;
  requestsLast24h: number;
  operations: Array<{
    actionType: string;
    requests: number;
  }>;
};

type ImagesResponse = {
  images: ImageItem[];
  folders: FolderItem[];
};

type UsageResponse = {
  usage: UsageSummary;
};

type SessionResponse = {
  authenticated: boolean;
};

const maxUploadBytes = 25 * 1024 * 1024;
const maxUploadCount = 20;
const allFolders = '__all__';
const defaultFolder = '未分類';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    throw new Error(message || 'API request failed');
  }

  return payload as T;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [password, setPassword] = useState('');
  const [images, setImages] = useState<ImageItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([{ name: defaultFolder, imageCount: 0 }]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState(allFolders);
  const [uploadFolder, setUploadFolder] = useState(defaultFolder);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredImages = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const scopedImages =
      activeFolder === allFolders ? images : images.filter((image) => image.folder === activeFolder);

    if (!keyword) return scopedImages;

    return scopedImages.filter((image) => image.name.toLowerCase().includes(keyword));
  }, [activeFolder, images, query]);

  const selected =
    filteredImages.find((image) => image.key === selectedKey) ?? filteredImages[0] ?? images[0];

  const refreshData = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const [imagesPayload, usagePayload] = await Promise.all([
        fetch('/api/images').then((response) => parseJsonResponse<ImagesResponse>(response)),
        fetch('/api/usage').then((response) => parseJsonResponse<UsageResponse>(response)),
      ]);

      setImages(imagesPayload.images);
      setFolders(imagesPayload.folders);
      setUsage(usagePayload.usage);
      setSelectedKey((current) => {
        const scopedImages =
          activeFolder === allFolders
            ? imagesPayload.images
            : imagesPayload.images.filter((image) => image.folder === activeFolder);
        if (current && scopedImages.some((image) => image.key === current)) return current;
        return scopedImages[0]?.key ?? imagesPayload.images[0]?.key ?? null;
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '無法讀取 R2 資料';
      setError(message);
      if (message.includes('未登入') || message.includes('Unauthorized')) setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const payload = await fetch('/api/session').then((response) =>
          parseJsonResponse<SessionResponse>(response),
        );
        setIsAuthenticated(payload.authenticated);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsCheckingSession(false);
      }
    };

    void checkSession();
  }, []);

  useEffect(() => {
    if (isAuthenticated) void refreshData();
  }, [isAuthenticated]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoggingIn(true);

    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password }),
      }).then((response) => parseJsonResponse<SessionResponse>(response));

      setPassword('');
      setIsAuthenticated(true);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登入失敗');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => null);
    setImages([]);
    setFolders([{ name: defaultFolder, imageCount: 0 }]);
    setUsage(null);
    setSelectedKey(null);
    setIsAuthenticated(false);
  };

  const addFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    if (imageFiles.length > maxUploadCount) {
      setError(`一次最多上傳 ${maxUploadCount} 張圖片。`);
      return;
    }

    const oversizedFile = imageFiles.find((file) => file.size > maxUploadBytes);
    if (oversizedFile) {
      setError(`${oversizedFile.name} 超過 ${formatBytes(maxUploadBytes)} 上傳限制。`);
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      imageFiles.forEach((file) => formData.append('files', file));
      formData.append('folder', uploadFolder);

      const payload = await fetch('/api/images', {
        method: 'POST',
        body: formData,
      }).then((response) => parseJsonResponse<ImagesResponse>(response));

      setImages(payload.images);
      setFolders(payload.folders);
      setActiveFolder(uploadFolder);
      setSelectedKey(payload.images[0]?.key ?? null);
      await refreshData();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上傳圖片失敗');
    } finally {
      setIsUploading(false);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const deleteImage = async (key: string) => {
    if (!confirm('確定要刪除這張圖片嗎？')) return;

    setError(null);

    try {
      const payload = await fetch(`/api/images?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }).then((response) => parseJsonResponse<ImagesResponse>(response));

      setImages(payload.images);
      setFolders(payload.folders);
      setSelectedKey(payload.images[0]?.key ?? null);
      await refreshData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '刪除圖片失敗');
    }
  };

  const copyImageUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('已複製圖片網址');
      window.setTimeout(() => setCopyStatus(null), 1800);
    } catch {
      setError('無法複製網址，請手動選取。');
    }
  };

  const createFolder = async () => {
    const folder = newFolderName.trim();
    if (!folder) return;

    setError(null);

    try {
      const payload = await fetch('/api/images', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ folder }),
      }).then((response) => parseJsonResponse<ImagesResponse>(response));

      setImages(payload.images);
      setFolders(payload.folders);
      setActiveFolder(folder);
      setUploadFolder(folder);
      setNewFolderName('');
    } catch (folderError) {
      setError(folderError instanceof Error ? folderError.message : '建立資料夾失敗');
    }
  };

  const totalSize = usage?.payloadSize ?? images.reduce((sum, image) => sum + image.size, 0);

  if (isCheckingSession) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <Loader2 className="spin" size={24} />
          <h1>ImageDock</h1>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={login}>
          <div className="auth-icon">
            <Lock size={22} />
          </div>
          <p className="eyebrow">Private R2 manager</p>
          <h1>ImageDock</h1>
          <label>
            <span>管理密碼</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="輸入 Cloudflare Pages 設定的 ADMIN_PASSWORD"
              autoComplete="current-password"
            />
          </label>
          {error ? (
            <div className="alert compact" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          ) : null}
          <button className="primary-button" type="submit" disabled={isLoggingIn || !password}>
            {isLoggingIn ? <Loader2 className="spin" size={18} /> : <Lock size={18} />}
            登入
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Cloudflare R2 image manager</p>
          <h1>ImageDock</h1>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={() => void refreshData()} aria-label="重新整理">
            <RefreshCw size={18} />
          </button>
          <button className="icon-button" onClick={() => void logout()} aria-label="登出">
            <LogOut size={18} />
          </button>
          <button
            className="primary-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? <Loader2 className="spin" size={18} /> : <ImagePlus size={18} />}
            上傳圖片
          </button>
        </div>
      </header>

      {error ? (
        <div className="alert" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="summary-band" aria-label="R2 使用摘要">
        <div>
          <span>圖片數</span>
          <strong>{usage?.objectCount ?? images.length}</strong>
        </div>
        <div>
          <span>儲存容量</span>
          <strong>{formatBytes(totalSize)}</strong>
        </div>
        <div>
          <span>24 小時請求</span>
          <strong>{usage?.requestsLast24h ?? 0}</strong>
        </div>
        <div>
          <span>中繼資料</span>
          <strong>{formatBytes(usage?.metadataSize ?? 0)}</strong>
        </div>
      </section>

      <section className="workspace">
        <aside className="library-panel">
          <div className="folder-panel">
            <div className="folder-heading">
              <span>
                <Folder size={17} />
                資料夾
              </span>
            </div>
            <button
              className={`folder-row ${activeFolder === allFolders ? 'is-active' : ''}`}
              onClick={() => setActiveFolder(allFolders)}
            >
              <span>全部圖片</span>
              <strong>{images.length}</strong>
            </button>
            {folders.map((folder) => (
              <button
                key={folder.name}
                className={`folder-row ${activeFolder === folder.name ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveFolder(folder.name);
                  setUploadFolder(folder.name);
                }}
              >
                <span>{folder.name}</span>
                <strong>{folder.imageCount}</strong>
              </button>
            ))}
            <div className="new-folder">
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createFolder();
                }}
                placeholder="新增資料夾"
              />
              <button onClick={() => void createFolder()} aria-label="新增資料夾">
                <FolderPlus size={17} />
              </button>
            </div>
          </div>

          <div
            className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            {isUploading ? <Loader2 className="spin" size={24} /> : <UploadCloud size={24} />}
            <strong>拖曳圖片到這裡</strong>
            <span>最多 {maxUploadCount} 張，每張 {formatBytes(maxUploadBytes)} 以內</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleInputChange}
            />
          </div>

          <label className="folder-select">
            <span>上傳到</span>
            <select value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)}>
              {folders.map((folder) => (
                <option key={folder.name} value={folder.name}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>

          <label className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋檔名"
            />
          </label>

          <div className="image-list">
            {isLoading ? (
              <div className="inline-state">
                <Loader2 className="spin" size={20} />
                <span>讀取 R2 圖片列表</span>
              </div>
            ) : null}

            {!isLoading && filteredImages.length === 0 ? (
              <div className="inline-state">
                <Images size={20} />
                <span>目前沒有圖片</span>
              </div>
            ) : null}

            {filteredImages.map((image) => (
              <button
                key={image.key}
                className={`image-row ${selected?.key === image.key ? 'is-selected' : ''}`}
                onClick={() => setSelectedKey(image.key)}
              >
                <img src={image.url} alt={image.name} />
                <span>
                  <strong>{image.name}</strong>
                  <small>{formatBytes(image.size)}</small>
                  <small>{image.folder}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="detail-panel" aria-label="圖片詳細資料">
          {selected ? (
            <>
              <div className="preview-area">
                <img src={selected.url} alt={selected.name} />
              </div>
              <div className="detail-content">
                <div className="detail-heading">
                  <div>
                    <p className="eyebrow">Selected R2 object</p>
                    <h2>{selected.name}</h2>
                  </div>
                  <button className="icon-button danger" onClick={() => void deleteImage(selected.key)}>
                    <Trash2 size={18} />
                  </button>
                </div>

                <dl className="metadata">
                  <div>
                    <dt>格式</dt>
                    <dd>{selected.type || '未知'}</dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{formatBytes(selected.size)}</dd>
                  </div>
                  <div>
                    <dt>資料夾</dt>
                    <dd>{selected.folder}</dd>
                  </div>
                  <div>
                    <dt>上傳時間</dt>
                    <dd>{new Date(selected.uploadedAt).toLocaleString('zh-TW')}</dd>
                  </div>
                  <div>
                    <dt>R2 Key</dt>
                    <dd>{selected.key}</dd>
                  </div>
                  <div>
                    <dt>公開網址</dt>
                    <dd>
                      <button
                        className="text-button"
                        onClick={() => void copyImageUrl(selected.url)}
                      >
                        <Copy size={15} />
                        {copyStatus || '複製網址'}
                      </button>
                    </dd>
                  </div>
                </dl>

                <div className="usage-panel">
                  <div className="usage-heading">
                    <Cloud size={18} />
                    <strong>最近 24 小時操作</strong>
                  </div>
                  <div className="operation-list">
                    {(usage?.operations.length ? usage.operations : [{ actionType: 'no data', requests: 0 }]).map(
                      (operation) => (
                        <div key={operation.actionType}>
                          <span>{operation.actionType}</span>
                          <strong>{operation.requests}</strong>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Images size={42} />
              <h2>尚未上傳圖片</h2>
              <p>從左側選取圖片，或直接拖曳檔案上傳到 R2。</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
