# Chi tiêu cá nhân

Ứng dụng theo dõi quỹ, thu chi và tài sản cá nhân. Fastify phục vụ API và bundle React SPA trên cùng origin; dữ liệu vẫn được lưu trong `data.json` tại root.

## Yêu cầu

- Node.js `>=20.19`
- npm đi kèm Node.js
- Google OAuth client loại **Web application**

## Cài đặt và cấu hình

```bash
npm install
cp .env.example .env
```

Điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` và một `SESSION_SECRET` ngẫu nhiên dài trong `.env`. Redirect URI của Google phải là:

```text
http://127.0.0.1:3000/api/auth/google/callback
```

Khi triển khai HTTPS, đổi `APP_BASE_URL` sang URL thật. Cookie phiên sẽ tự bật `Secure`.

## Chạy ứng dụng

```bash
# Phát triển: Fastify + Vite HMR tại cùng origin
npm run dev

# Production
npm run build
npm start
```

Mở `http://127.0.0.1:3000`. `/` chuyển tới `/expenses`; các deep link `/funds`, `/expenses`, `/statistics` đều có thể refresh trực tiếp.

## Cấu trúc

```text
apps/
  server/       Fastify, OAuth, repository JSON, market service, SPA hosting
  web/          React, React Router, Zustand, Chart.js, Flatpickr
packages/
  shared/       Kiểu dữ liệu và hợp đồng API dùng chung
```

`apps/server/src/app.ts` xuất factory `buildApp(options)` để test bằng `app.inject()` mà không mở cổng. Production chỉ cần Fastify và bundle tại `apps/web/dist/client`; trình duyệt không tải thư viện từ CDN.

## Kiểm tra

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Lần đầu chạy E2E cần cài Chromium do Playwright quản lý:

```bash
npx playwright install chromium
```

E2E dùng database tạm và route đăng nhập chỉ có trong test server. Bộ test không đọc/ghi `data.json` thật.

## Dữ liệu và an toàn

- Không sửa hoặc format lại `data.json` thủ công.
- Repository ghi qua file tạm rồi rename nguyên tử và tuần tự hóa các lượt ghi.
- Giới hạn payload là 5 MiB.
- Server tĩnh chỉ phục vụ bundle; `data.json`, dotfile và file ngoài bundle không thể truy cập.
- Session và OAuth state ở bộ nhớ, nên người dùng cần đăng nhập lại sau khi restart server.
- Bản sao lưu từ phiên bản cũ vẫn được chuẩn hóa khi nhập.
