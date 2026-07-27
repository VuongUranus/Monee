# Chi tiêu cá nhân

Ứng dụng theo dõi quỹ, thu chi và tài sản cá nhân. Fastify là backend duy nhất truy cập Neon PostgreSQL; React chỉ làm việc qua API cùng origin. Dữ liệu nghiệp vụ được chuẩn hoá thành các bảng quan hệ, không lưu snapshot hay payload nghiệp vụ bằng JSONB.

## Yêu cầu

- Node.js `>=20.19`
- npm đi kèm Node.js
- Neon PostgreSQL
- Google OAuth client loại **Web application**
- Docker cho integration test PostgreSQL/Testcontainers

## Cấu hình Neon

Tạo project/branch Neon gần region chạy Fastify rồi sao chép `.env.example` thành `.env`:

```bash
npm install
cp .env.example .env
```

Hai URL có mục đích tách biệt:

- `DATABASE_URL`: URL pooled có hostname `-pooler`, dùng bởi Fastify runtime. Pool ứng dụng tối đa 10 connection.
- `DATABASE_MIGRATION_URL`: URL direct, dùng riêng cho migration, import và verify.

Không dùng `drizzle-kit push` ở production và server không tự chạy migration lúc khởi động.

### Độ trễ

- Đặt Fastify và Neon trong cùng region. Nếu chạy backend tại Việt Nam/Singapore, ưu tiên project Neon AWS Singapore (`aws-ap-southeast-1`) thay vì US East; region của project đã tạo không đổi tại chỗ, cần tạo project mới rồi migrate dữ liệu.
- Neon Free scale compute về zero sau thời gian idle, nên request đầu tiên có thể chậm hơn; các request nóng mới là số liệu phù hợp để đánh giá query.
- Runtime phải dùng pooled URL có `-pooler`; direct URL chỉ dành cho migration/import/verify.
- Dùng `sslmode=verify-full` trong connection string để xác minh hostname/chứng chỉ rõ ràng và tránh thay đổi semantics của `pg` phiên bản tương lai.
- `/api/data` chỉ trả bootstrap nhỏ. Các màn hình gọi read model riêng; CRUD thông thường chỉ cập nhật các hàng thay đổi. Full assembler chỉ dùng khi xuất backup, import rehearsal và verify.

## Migration và import

Migration SQL được commit trong `apps/server/drizzle/`.

```bash
npm run db:generate
npm run db:migrate
npm run db:import-json -- --file ./data.json
npm run db:verify-json -- --file ./data.json
```

Importer hỗ trợ database JSON schema v3/v4, chuẩn hoá market legacy, account/category/onboarding và income legacy. Toàn bộ users, quỹ cá nhân/chung, member, contribution và dữ liệu con được ghi trong một transaction.

Importer:

- ghi SHA-256 và thống kê vào `data_imports`;
- no-op khi checksum đã được import;
- từ chối ghi đè nếu database đã chứa dữ liệu khác;
- tự deep-compare workspace canonical sau import;
- đối soát thêm số user, quỹ, transaction, lot, member và contribution.

`db:verify-json` dùng để xác nhận snapshot tại thời điểm cutover. Sau khi ứng dụng đã phát sinh CRUD mới, việc Neon khác file backup cũ là bình thường; không import lại snapshot cũ để “sửa” chênh lệch này.

### Cutover production

1. Chạy migration/import/verify trên một Neon branch rehearsal.
2. Trong maintenance window, dừng phiên bản còn ghi JSON.
3. Chạy lại migration/import/verify trên branch chính với file cuối cùng.
4. Deploy bằng pooled `DATABASE_URL`, rồi smoke-test đăng nhập, đọc, CRUD, chia sẻ và backup.
5. Chỉ sau khi verify production thành công mới chạy `git rm data.json` và giữ một bản rollback ngoài repository.

`data.json` đã nằm trong `.gitignore`, nhưng bản đang được Git theo dõi phải được giữ nguyên cho đến bước 5.

## Chạy ứng dụng

```bash
# Fastify + Vite HMR cùng origin
npm run dev

# Production
npm run build
npm start
```

Mở `http://127.0.0.1:3000`. `/` chuyển tới `/expenses`; các deep link `/funds`, `/expenses`, `/debts`, `/statistics` refresh trực tiếp.

Fastify kiểm tra `SELECT 1` khi startup và đóng pool theo lifecycle. Mọi mutation cá nhân dùng `workspaceRevision`; quỹ chung dùng revision riêng và trả `409` khi client stale.

Các read model chính:

- `GET /api/data`: user, preferences, revision và danh sách năm.
- `GET /api/expenses/config`, `GET /api/expenses/summary`: cấu hình và tổng hợp chi tiêu.
- `GET /api/transactions`: lọc, tìm kiếm và phân trang server-side.
- `GET /api/funds/overview`, `GET /api/funds/:id/months/:year/:month`: tổng quan và chi tiết tải lười.
- `GET /api/debts`, `GET /api/debts/:id`: tổng hợp khoản vay/nợ, lịch trả và lịch sử thanh toán.
- `GET /api/statistics`: thống kê đã `GROUP BY` ở PostgreSQL.
- `GET /api/backup/export`: endpoint online duy nhất dựng đầy đủ dữ liệu private.

API lớn hơn 1 KiB được nén bằng Brotli/gzip/deflate. Response API có `Cache-Control: no-store`, `Server-Timing` cho thời gian DB/app và `X-Response-Bytes` để chẩn đoán latency.

Xem [tài liệu HTTP API](docs/API.md) để biết đầy đủ chức năng, request, response, phân trang, quyền quỹ chung và quy tắc revision conflict.

## Chia sẻ quỹ

Trong **Quỹ → Quản lý quỹ**, chủ quỹ có thể chia sẻ từng quỹ với email Google đã từng đăng nhập. Viewer chỉ đọc; editor sửa metadata, month/detail, goal và contribution; chỉ owner quản lý member hoặc xoá quỹ. Backup cá nhân không ghi đè quỹ chung.

## Cấu trúc

```text
apps/
  server/       Fastify, OAuth, Drizzle schema/repository, migration/import, market, SPA hosting
  web/          React, React Router, Zustand, Chart.js, Flatpickr
packages/
  shared/       Kiểu dữ liệu, API contracts và canonical legacy normalization
```

## Kiểm tra

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Integration test tạo PostgreSQL thật bằng Testcontainers (hoặc dùng `TEST_DATABASE_URL`) và mỗi suite dùng database cô lập. Lần đầu chạy E2E có thể cần:

```bash
npx playwright install chromium
```

Session đăng nhập và OAuth state/PKCE được lưu trong PostgreSQL, nên server restart không làm client phải đăng nhập lại (trong thời hạn session 7 ngày). `SESSION_SECRET` phải giữ nguyên giữa các lần restart/deploy; thay đổi secret sẽ vô hiệu hóa cookie session hiện có. Giới hạn body API là 5 MiB.
