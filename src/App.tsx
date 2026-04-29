import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';
import {
  ImagePlus,
  Images,
  Search,
  Tag,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';

type ImageItem = {
  id: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
  dataUrl: string;
  tags: string[];
};

const storageKey = 'imagedock.images';

function loadImages(): ImageItem[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as ImageItem[];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function fileToImageItem(file: File): Promise<ImageItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        createdAt: new Date().toISOString(),
        dataUrl: String(reader.result),
        tags: [],
      });
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [images, setImages] = useState<ImageItem[]>(loadImages);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = images.find((image) => image.id === selectedId) ?? images[0];

  const filteredImages = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) return images;

    return images.filter((image) => {
      const tagText = image.tags.join(' ').toLowerCase();
      return image.name.toLowerCase().includes(keyword) || tagText.includes(keyword);
    });
  }, [images, query]);

  const persistImages = (nextImages: ImageItem[]) => {
    setImages(nextImages);
    localStorage.setItem(storageKey, JSON.stringify(nextImages));
  };

  const addFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const nextItems = await Promise.all(imageFiles.map(fileToImageItem));
    const nextImages = [...nextItems, ...images];
    persistImages(nextImages);
    setSelectedId(nextItems[0].id);
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

  const addTag = () => {
    const value = tagInput.trim();
    if (!selected || !value || selected.tags.includes(value)) return;

    persistImages(
      images.map((image) =>
        image.id === selected.id ? { ...image, tags: [...image.tags, value] } : image,
      ),
    );
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    if (!selected) return;

    persistImages(
      images.map((image) =>
        image.id === selected.id
          ? { ...image, tags: image.tags.filter((item) => item !== tag) }
          : image,
      ),
    );
  };

  const deleteImage = (id: string) => {
    const nextImages = images.filter((image) => image.id !== id);
    persistImages(nextImages);
    setSelectedId(nextImages[0]?.id ?? null);
  };

  const totalSize = images.reduce((sum, image) => sum + image.size, 0);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local image manager</p>
          <h1>ImageDock</h1>
        </div>
        <button className="primary-button" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus size={18} />
          上傳圖片
        </button>
      </header>

      <section className="summary-band" aria-label="圖片摘要">
        <div>
          <span>圖片數</span>
          <strong>{images.length}</strong>
        </div>
        <div>
          <span>總容量</span>
          <strong>{formatBytes(totalSize)}</strong>
        </div>
        <div>
          <span>標籤數</span>
          <strong>{new Set(images.flatMap((image) => image.tags)).size}</strong>
        </div>
      </section>

      <section className="workspace">
        <aside className="library-panel">
          <div
            className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <UploadCloud size={24} />
            <strong>拖曳圖片到這裡</strong>
            <span>支援 JPG、PNG、GIF、WebP 等圖片格式</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleInputChange}
            />
          </div>

          <label className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋檔名或標籤"
            />
          </label>

          <div className="image-list">
            {filteredImages.map((image) => (
              <button
                key={image.id}
                className={`image-row ${selected?.id === image.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(image.id)}
              >
                <img src={image.dataUrl} alt={image.name} />
                <span>
                  <strong>{image.name}</strong>
                  <small>{formatBytes(image.size)}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="detail-panel" aria-label="圖片詳細資料">
          {selected ? (
            <>
              <div className="preview-area">
                <img src={selected.dataUrl} alt={selected.name} />
              </div>
              <div className="detail-content">
                <div className="detail-heading">
                  <div>
                    <p className="eyebrow">Selected image</p>
                    <h2>{selected.name}</h2>
                  </div>
                  <button className="icon-button danger" onClick={() => deleteImage(selected.id)}>
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
                    <dt>建立時間</dt>
                    <dd>{new Date(selected.createdAt).toLocaleString('zh-TW')}</dd>
                  </div>
                </dl>

                <div className="tag-editor">
                  <label>
                    <Tag size={17} />
                    <input
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addTag();
                      }}
                      placeholder="新增標籤"
                    />
                  </label>
                  <button onClick={addTag}>加入</button>
                </div>

                <div className="tags">
                  {selected.tags.length > 0 ? (
                    selected.tags.map((tag) => (
                      <button key={tag} onClick={() => removeTag(tag)}>
                        {tag}
                        <X size={14} />
                      </button>
                    ))
                  ) : (
                    <span className="empty-tags">尚未設定標籤</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Images size={42} />
              <h2>尚未上傳圖片</h2>
              <p>從左側選取圖片，或直接拖曳檔案開始建立圖片庫。</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
