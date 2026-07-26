# HTTP API

Tài liệu này mô tả API đang được Fastify phục vụ cùng origin với web app. Contract TypeScript chuẩn nằm trong [`packages/shared/src/index.ts`](../packages/shared/src/index.ts). API không có version prefix; một thay đổi breaking phải được deploy đồng thời frontend và backend.

## Quy ước chung

- Base URL local: `http://127.0.0.1:3000`.
- Các endpoint JSON dùng `Content-Type: application/json`. Request không cần `Authorization` header: session được giữ bằng cookie `finance_session` HTTP-only sau Google OAuth.
- Mọi endpoint dưới `/api`, trừ bắt đầu/kết thúc luồng OAuth, cần đăng nhập. Khi chưa có session, server trả `401`.
- Tiền được truyền/trả dưới dạng JSON `number`, đơn vị VND. `amount` của giao dịch, contribution phải lớn hơn 0; các số tiền cấu hình/quỹ khác được phép bằng 0.
- `year` trong khoảng `1900..9999`; `month` là `1..12`; ngày là `YYYY-MM-DD`; kỳ contribution/statistics là `YYYY-MM`.
- API response có `Cache-Control: no-store`. Response lớn hơn 1 KiB có thể được nén Brotli/gzip/deflate. `Server-Timing` và `X-Response-Bytes` là header chẩn đoán hiệu năng.

### Lỗi

Mọi lỗi JSON có cùng dạng:

```json
{ "error": "revision_conflict", "message": "Dữ liệu đã được cập nhật ở nơi khác. Hãy tải lại." }
```

| Status | `error` thường gặp | Ý nghĩa / xử lý client |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_range`, `invalid_order`, `last_fund`, `last_category` | Kiểm tra input hoặc quy tắc nghiệp vụ. |
| 401 | `unauthorized` | Đăng nhập lại. |
| 403 | `forbidden` | Không có role cần thiết trong quỹ chung. |
| 404 | `fund_not_found`, `transaction_not_found`, `category_not_found`, `account_not_found` | Tài nguyên đã bị xoá/không thuộc workspace hiện tại; tải lại màn hình. |
| 409 | `revision_conflict`, `shared_fund_conflict` | Xoá cache liên quan và tải lại trước khi người dùng thao tác tiếp. |
| 503 | `oauth_not_configured` | Server thiếu cấu hình Google OAuth. |

### Revision cho mutation

Mutation **cá nhân** phải gửi `expectedRevision`, lấy từ `GET /api/data`. Khi thành công, response có dạng:

```json
{ "data": { "id": "food", "name": "Ăn uống", "color": "#f97316" }, "workspaceRevision": 18 }
```

Lưu `workspaceRevision` mới trước mutation kế tiếp. Revision kiểm soát tất cả dữ liệu private của một user, gồm preferences, quỹ private, thu chi và cấu hình tài khoản.

Mutation **quỹ chung** gửi `revision` của chính quỹ (lấy từ overview/members/contributions) và trả:

```json
{ "data": { "fundId": "holiday", "year": 2026, "month": 7, "amount": 1500000, "detail": null }, "revision": 6 }
```

Role quỹ chung: `viewer` chỉ đọc; `editor` sửa metadata, month/detail, goal và contribution; `owner` còn có thể thêm/xoá member và xoá quỹ.

### Các kiểu dữ liệu thường dùng

```ts
type FundCategory = "saving" | "stock" | "gold" | "crypto";
type TransactionType = "income" | "expense";
type SharedFundRole = "viewer" | "editor";

interface Transaction {
  id: string; date: string; type: TransactionType; cat: string;
  accountId?: string; amount: number; note: string;
}
interface Fund { id: string; name: string; color: string; cat: FundCategory; }
interface FinanceCategory { id: string; name: string; color: string; budget?: number; }
interface AccountType { id: string; name: string; }
interface Account { id: string; name: string; typeId?: string; }
```

`FundDetail` là `null`, `{ "type": "hold", "lots": [...] }` cho cổ phiếu/crypto, hoặc `{ "type": "gold", "lots": [...] }` cho vàng. Chi tiết đầy đủ của lot được định nghĩa trong shared contract.

## Xác thực

| Method, path | Chức năng | Request | Response |
| --- | --- | --- | --- |
| `GET /api/auth/me` | Kiểm tra session hiện tại. | Không có. | `{ "user": UserProfile }` với `sub`, `email`, `name`, `picture`. |
| `GET /api/auth/google?returnTo=/funds` | Bắt đầu Google OAuth PKCE. | `returnTo` tùy chọn, chỉ nên là route nội bộ. | `302` đến Google, đặt cookie OAuth tạm thời. |
| `GET /api/auth/google/callback` | Google gọi lại sau khi cho phép. | `state`, `code` do Google cung cấp. | `302` về `returnTo`, đặt cookie session. Không gọi trực tiếp từ frontend. |
| `POST /api/auth/logout` | Xoá session/cookie. | Không có body. | `204 No Content`. |

## Bootstrap, backup và import

### `GET /api/data`

Tải phần tối thiểu cần để khởi tạo app. Không trả giao dịch, fund month/detail, quote hay nội dung quỹ chung.

```json
{
  "user": { "sub": "google-id", "email": "me@example.com", "name": "Minh", "picture": "" },
  "workspaceRevision": 17,
  "preferences": {
    "showGoals": true,
    "onboarding": { "status": "completed", "version": 1 },
    "financialProfile": {
      "monthlyIncome": 25000000,
      "emergencyFundGoal": 100000000,
      "debt": { "balance": 0, "monthlyPayment": 0 }
    },
    "incomeMigrationVersion": 1,
    "futureIncomeResetVersion": 1,
    "usdRate": 26000
  },
  "availableYears": [2025, 2026]
}
```

### Backup/import

| Method, path | Chức năng | Request | Response |
| --- | --- | --- | --- |
| `GET /api/backup/export` | Dựng toàn bộ **private** `FinanceStore` để tải backup. Đây là endpoint online duy nhất dùng full assembler. Quỹ chung không nằm trong backup thay thế. | Không có. | `StoredFinancePayload` theo định dạng backup hiện tại. |
| `PUT /api/data/import` | Thay toàn bộ dữ liệu private bằng backup trong một transaction. | `{ "expectedRevision": 17, "data": { /* StoredFinancePayload */ } }` | `FinanceBootstrapResponse` mới; client phải xoá cache tài nguyên và tải route hiện tại lại. |

## API đọc theo tài nguyên

### Chi tiêu

| Method, path | Chức năng | Query | Response |
| --- | --- | --- | --- |
| `GET /api/expenses/config` | Tải cấu hình form/lọc chi tiêu. | — | `{ categories: FinanceCategory[], incomeCategories: FinanceCategory[], accountTypes: AccountType[], accounts: Account[] }` |
| `GET /api/expenses/summary` | Tổng hợp thu, chi, phân bổ quỹ và số dư của một tháng. | `year`, `month` (bắt buộc). | `{ year, month, income, spent, funds, balance, byExpenseCategory, byIncomeCategory, accountExpenses }`. Hai `by*Category` là map `{ [categoryId]: amount }`; `accountExpenses` là mảng `{ id, name, color, amount }`. |
| `GET /api/transactions` | Lịch sử giao dịch lọc và phân trang server-side; sort `date DESC, id DESC`. | Bắt buộc: `from`, `to`. Tùy chọn: `type=income\|expense`, `categoryId`, `accountId`, `q` (tối đa 500 ký tự), `page` (mặc định 1), `pageSize` (mặc định 10, tối đa 100). | `{ items: Transaction[], total, page, pageSize, pageCount }` |

Ví dụ:

```http
GET /api/transactions?from=2026-07-01&to=2026-07-31&type=expense&q=c%C3%A0%20ph%C3%AA&page=1&pageSize=10
```

### Quỹ

| Method, path | Chức năng | Request | Response |
| --- | --- | --- | --- |
| `GET /api/funds/overview?year=2026&month=7` | Tải card quỹ private/quỹ chung, 12 tháng của năm và số liệu tổng hợp. Không tải lots. | `year`, `month` bắt buộc. | `FundOverviewResponse`: `year`, `month`, `note`, `income`, `yearActiveMonths`, `allTimeActiveMonths`, `showGoals`, `debt`, `marketAssets`, `market`, `funds`. |
| `GET /api/funds/:id/months/:year/:month` | Tải lười lots/detail khi mở modal quỹ. Kiểm tra quyền quỹ chung. | Path `id`, `year`, `month`. | `{ fundId, year, month, amount, detail }` |
| `GET /api/shared-funds/:id/members` | Tải danh sách thành viên khi mở modal. | Path `id`. | `{ fundId, revision, members: [{ user: { sub, name, email }, role }] }` |
| `GET /api/shared-funds/:id/contributions?year=2026&month=7` | Tải contribution một kỳ của quỹ chung. | Path `id`; query `year`, `month`. | `{ fundId, revision, period: "2026-07", contributors, items }`; `items` là `{ id, memberId, amount, note, createdAt }[]`. |

Mỗi phần tử `funds` trong overview có metadata `id`, `name`, `color`, `cat`, `fundPlan`, `openingBalance`, `yearGoal`, `allGoal`, `monthAmount`, `yearAmounts` (mảng 12 phần tử), `yearTotal`, `allTimeTotal`, `contributionAmount`, `contributionCount`. Quỹ chung có thêm `revision`, `role` và `owner`.

### Thống kê

`GET /api/statistics` trả dữ liệu đã tổng hợp bằng PostgreSQL, không phải giao dịch thô. Chọn đúng một scope:

| Query | Phạm vi |
| --- | --- |
| `mode=all` | Tất cả thời gian. |
| `mode=year&year=2026` | Một năm. |
| `mode=month&month=2026-07` | Một tháng. |
| `mode=range&from=2026-01&to=2026-07` | Khoảng tháng, `from <= to`. |

Response:

```json
{
  "scope": { "mode": "year", "year": 2026 },
  "availableYears": [2025, 2026],
  "funds": [{ "id": "emergency", "name": "Khẩn cấp", "color": "#2563eb" }],
  "rows": [{ "year": 2026, "month": 7, "key": "2026-07", "income": 25000000, "spent": 8000000, "funds": 5000000, "balance": 12000000, "byFund": { "emergency": 5000000 } }],
  "totals": { "income": 25000000, "spent": 8000000, "funds": 5000000, "balance": 12000000 },
  "expenseBreakdown": [{ "id": "food", "name": "Ăn uống", "color": "#f97316", "amount": 2000000 }],
  "incomeBreakdown": [],
  "accountExpenses": []
}
```

Số liệu quỹ chỉ gồm quỹ private và quỹ chung do user sở hữu, để giữ đúng ngữ nghĩa báo cáo hiện tại.

## Mutation dữ liệu cá nhân

Các endpoint trong bảng này đều cần `expectedRevision` trong JSON body và trả `PersonalMutationResponse<T>`: `{ data: T, workspaceRevision: number }`.

| Method, path | Chức năng | Body ngoài `expectedRevision` | `data` khi thành công |
| --- | --- | --- | --- |
| `PATCH /api/preferences` | Cập nhật cài đặt/onboarding/hồ sơ cơ bản. | `showGoals?`, `financialProfile?: { monthlyIncome?, emergencyFundGoal?, debtBalance?, debtMonthlyPayment? }`, `onboarding?: { status, version, skippedAt? }` | `FinancePreferences` mới. |
| `PUT /api/years/:year` | Tạo năm nếu chưa có. Idempotent. | — | `{ year }` |
| `PATCH /api/years/:year/months/:month` | Sửa ghi chú tháng. | `{ note }`, tối đa 10.000 ký tự. | `{ year, month, note }` |
| `POST /api/years/:year/months/:month/reset` | Xoá phân bổ/detail quỹ private và ghi chú của tháng. | — | `{ year, month }` |
| `POST /api/funds` | Tạo quỹ private. | `{ name, color, category }` | `Fund` mới. |
| `PATCH /api/funds/:id` | Sửa metadata quỹ private. | Bất kỳ: `name?`, `color?`, `category?`, `fundPlan?`, `openingBalance?`. | `Fund` đã sửa. |
| `DELETE /api/funds/:id` | Xoá quỹ private, trừ quỹ cuối cùng. | — | `{ deletedId }` |
| `PUT /api/funds/order` | Lưu thứ tự quỹ. | `{ ids: string[] }` phải là thứ tự hợp lệ. | `{ ids }` |
| `PUT /api/funds/:id/months/:year/:month` | Upsert giá trị/thông tin tài sản một tháng. | `{ amount, detail? }`; `detail` là `FundDetail` hoặc `null`. | `{ fundId, year, month, amount, detail }` |
| `PUT /api/funds/:id/goals` | Đặt mục tiêu năm hoặc toàn thời gian. | `{ year: number \| null, amount }`; `null` là all-time. | `{ fundId, year, amount }` |

Ví dụ cập nhật tháng quỹ:

```json
{
  "expectedRevision": 17,
  "amount": 2500000,
  "detail": {
    "type": "hold",
    "lots": [{ "ticker": "FPT", "qty": 10, "purchasePrice": 120000, "purchasedAt": "2026-07-10" }]
  }
}
```

### Giao dịch, danh mục và tài khoản

Các endpoint sau cũng dùng response/revision cá nhân chung.

| Method, path | Chức năng | Body ngoài `expectedRevision` | `data` |
| --- | --- | --- | --- |
| `POST /api/transactions` | Tạo giao dịch. | `{ transaction: { id?, date, type, cat, accountId?, amount, note } }` | `Transaction` mới. |
| `PUT /api/transactions/:id` | Sửa giao dịch. | `{ transaction: { date, type, cat, accountId?, amount, note } }` | `Transaction` đã sửa. |
| `DELETE /api/transactions/:id` | Xoá giao dịch. | — | `{ deletedId }` |
| `POST /api/categories` | Tạo danh mục thu/chi. | `{ type: "income"\|"expense", name, color, budget? }`; budget chỉ dùng cho expense. | `FinanceCategory` mới. |
| `PATCH /api/categories/:type/:id` | Sửa danh mục. | `{ name?, color?, budget? }` | `FinanceCategory` đã sửa. |
| `DELETE /api/categories/:type/:id` | Xoá/soft-delete danh mục; lịch sử cũ vẫn hiển thị. | — | `{ deletedId }` |
| `PUT /api/categories/:type/order` | Lưu thứ tự danh mục theo type. | `{ ids: string[] }` | `{ ids }` |
| `POST /api/account-types` | Tạo loại tài khoản. | `{ name }` | `AccountType` mới. |
| `PATCH /api/account-types/:id` | Đổi tên loại tài khoản. | `{ name }` | `AccountType` đã sửa. |
| `DELETE /api/account-types/:id` | Xoá loại tài khoản; account cũ mất `typeId`. | — | `{ deletedId }` |
| `PUT /api/account-types/order` | Lưu thứ tự loại tài khoản. | `{ ids: string[] }` | `{ ids }` |
| `POST /api/accounts` | Tạo tài khoản. | `{ name, typeId? }` | `Account` mới. |
| `PATCH /api/accounts/:id` | Sửa tài khoản. | `{ name?, typeId?: string \| null }` | `Account` đã sửa. |
| `DELETE /api/accounts/:id` | Xoá/soft-delete account; giao dịch cũ vẫn hợp lệ. | — | `{ deletedId }` |
| `PUT /api/accounts/order` | Lưu thứ tự account. | `{ ids: string[] }` | `{ ids }` |

## Quỹ chung

### Tạo chia sẻ

`POST /api/shared-funds` chuyển một quỹ private thành quỹ chung/chia sẻ với một user đã từng đăng nhập. Đây là mutation cá nhân nên body dùng `expectedRevision` và response là `{ data, workspaceRevision }`.

```json
{ "fundId": "holiday", "email": "friend@example.com", "role": "editor", "expectedRevision": 17 }
```

`data` là `{ "id": "holiday", "revision": 1 }`. Không thể chia sẻ cho chính chủ; email đích phải đã đăng nhập app ít nhất một lần.

### Sửa quỹ chung

Các endpoint còn lại dùng body `revision` và response `{ data, revision }`.

| Method, path | Quyền | Body ngoài `revision` | `data` |
| --- | --- | --- | --- |
| `PATCH /api/shared-funds/:id` | editor/owner | `name?`, `color?`, `category?`, `fundPlan?`, `openingBalance?` | `{ id, name, color, cat, fundPlan, openingBalance }` |
| `PUT /api/shared-funds/:id/months/:year/:month` | editor/owner | `{ amount, detail? }` | `{ fundId, year, month, amount, detail }` |
| `PUT /api/shared-funds/:id/goals` | editor/owner | `{ year: number \| null, amount }` | `{ fundId, year, amount }` |
| `PUT /api/shared-funds/:id/members` | owner | `{ email, role: "viewer"\|"editor" }` | `{ fundId, member: { user: { sub, email, name }, role } }` |
| `DELETE /api/shared-funds/:id/members/:memberId` | owner | — | `{ deletedId: memberId }` |
| `POST /api/shared-funds/:id/contributions` | editor/owner | `{ month: "YYYY-MM", amount, note? }` | `{ id, memberId, amount, note, createdAt }` |
| `DELETE /api/shared-funds/:id` | owner | — | `{ deletedId: id }` |

## Giá thị trường

### `POST /api/market/quotes`

Lấy quote từ provider, lưu các quote chuẩn hoá và tính lại các fund month bị ảnh hưởng trong transaction. Đây là mutation cá nhân, nên body có `expectedRevision`.

```json
{
  "expectedRevision": 17,
  "force": false,
  "assets": [
    { "type": "gold" },
    { "type": "stock", "symbol": "FPT", "exchange": "HOSE" },
    { "type": "crypto", "symbol": "BTC", "providerId": "bitcoin" }
  ]
}
```

Response:

```json
{
  "quotes": {
    "fetchedAt": "2026-07-27T10:00:00.000Z",
    "fx": null,
    "gold": null,
    "stocks": [],
    "crypto": [],
    "matches": {},
    "errors": []
  },
  "workspaceRevision": 18,
  "affectedPeriods": ["2026-07"]
}
```

`assets` nhận `type` là `gold`, `stock` hoặc `crypto`; `symbol`, `exchange`, `providerId` là tùy loại tài sản. `quotes.errors` là lỗi theo từng quote, không nhất thiết làm toàn bộ request thất bại.

## Vận hành client

- Sau bootstrap, chỉ tải resource của route hiện tại. Khi đổi tháng/năm chỉ refetch resource của route đó.
- Các `GET` URL giống nhau đang chạy được frontend gộp thành một request để React Strict Mode và event đổi kỳ không tạo request mạng trùng.
- Khi mutation trả `409 revision_conflict`, xoá personal cache, gọi lại bootstrap rồi tải resource của route hiện tại. Với `shared_fund_conflict`, chỉ refetch overview/detail/members/contributions của quỹ đó.
- Sau create/update/delete, invalidate đúng dependency: chi tiêu ảnh hưởng expense summary/transactions/statistics; quỹ ảnh hưởng overview/statistics; market ảnh hưởng overview các `affectedPeriods`.
