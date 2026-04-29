# ImageDock

ImageDock 是一個簡單的圖片上傳與管理小工具。前端使用 React/Vite，後端使用 Cloudflare Pages Functions 串接 Cloudflare R2。

## 功能

- 拖曳或選取圖片上傳到 Cloudflare R2
- 圖片預覽與基本資訊
- 搜尋檔名
- 查看已上傳圖片列表
- 刪除 R2 圖片
- 查看 R2 儲存容量、物件數、中繼資料大小與最近 24 小時操作請求量

## 環境變數

本機請建立 `.env.local`，部署到 Cloudflare Pages 時請在專案設定加入同名環境變數：

```bash
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
CLOUDFLARE_API_TOKEN=
```

Cloudflare Pages 另外需要在 **Settings > Functions > R2 bucket bindings** 新增 binding：

- Variable name: `R2_BUCKET`
- R2 bucket: `my-photo-storage`

`R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY` 目前保留給後續 S3 相容 API 或外部工具使用；Pages Functions 操作 R2 會優先使用 `R2_BUCKET` binding，避免在前端暴露密鑰。

## 開發

```bash
npm install
npm run dev
```

`npm run dev` 只會啟動 Vite 前端。要在本機測試 Cloudflare Pages Functions，請使用 Cloudflare Pages 的本機開發流程，並綁定 R2 bucket。

## 建置

```bash
npm run build
```
