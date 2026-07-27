import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/__test/login");
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByRole("heading", { name: "Theo dõi chi tiêu" })).toBeVisible();
});

test("deep link ba trang và refresh hoạt động", async ({ page }) => {
  await page.goto("/funds");
  await expect(page.getByRole("heading", { name: "Theo dõi quỹ dự phòng & đầu tư" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Phân bổ theo quỹ/ })).toBeVisible();

  await page.goto("/statistics");
  await expect(page.getByRole("heading", { name: "Thống kê tài chính", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Diễn biến tích lũy/ })).toBeVisible();
});

test("thêm, sửa, lọc và xóa giao dịch", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Luồng CRUD đầy đủ chỉ cần chạy một lần ở desktop.");
  const amount = page.getByRole("textbox", { name: "Số tiền" });
  await amount.fill("250000");
  await amount.blur();
  await page.getByRole("textbox", { name: "Ghi chú", exact: true }).fill("Kiểm thử bữa trưa");
  await page.getByRole("button", { name: "+ Thêm khoản" }).click();
  await expect(page.getByText("Kiểm thử bữa trưa")).toBeVisible();

  await page.getByLabel("Sửa giao dịch").click();
  const editingRow = page.locator("tr.editing-row");
  await editingRow.getByRole("textbox", { name: "Ghi chú đang sửa" }).fill("Bữa trưa đã sửa");
  await page.getByLabel("Lưu giao dịch").click();
  await expect(page.getByText("Bữa trưa đã sửa")).toBeVisible();

  await page.getByRole("textbox", { name: "Tìm ghi chú", exact: true }).fill("đã sửa");
  await expect(page.getByText("Có 1 khoản · 1–1")).toBeVisible();
  await page.getByLabel("Xóa giao dịch").click();
  await expect(page.getByText("Không tìm thấy giao dịch phù hợp.")).toBeVisible();
});

test("phân bổ quỹ, chi tiết tài sản và sao lưu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Luồng nhập liệu đầy đủ chỉ cần chạy một lần ở desktop.");
  await page.goto("/funds");
  const savingRow = page.locator("tr").filter({ hasText: "Quỹ dự phòng" });
  const saving = savingRow.getByRole("textbox");
  await saving.fill("1000000");
  await saving.blur();
  await expect(savingRow).toContainText("1,000,000đ");

  const goldRow = page.locator("tr").filter({ hasText: "Quỹ mua vàng" });
  await goldRow.getByRole("button", { name: /Chỉnh chi tiết/ }).click();
  const goldDialog = page.getByRole("dialog", { name: /Quỹ mua vàng/ });
  await goldDialog.getByRole("button", { name: "+ Thêm giao dịch" }).click();
  await goldDialog.getByRole("button", { name: "+ Thêm giao dịch" }).click();
  await goldDialog.getByRole("spinbutton").nth(0).fill("1");
  await goldDialog.getByRole("spinbutton").nth(1).fill("1");
  await goldDialog.getByRole("textbox", { name: "Giá thủ công vàng 1" }).fill("7500000");
  await goldDialog.getByRole("textbox", { name: "Giá thủ công vàng 1" }).blur();
  await goldDialog.getByRole("textbox", { name: "Giá thủ công vàng 2" }).fill("7500000");
  await goldDialog.getByRole("textbox", { name: "Giá thủ công vàng 2" }).blur();
  await goldDialog.getByRole("textbox", { name: "Giá mua vàng 1" }).fill("7000000");
  await goldDialog.getByRole("textbox", { name: "Giá mua vàng 1" }).blur();
  await goldDialog.getByRole("textbox", { name: "Ghi chú" }).nth(0).fill("Mua vàng kiểm thử");
  await goldDialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(goldRow).toContainText("15,000,000đ");

  await page.getByRole("button", { name: /Xuất sao lưu/ }).click();
  await expect(page.getByRole("dialog", { name: "Sao lưu dữ liệu" })).toBeVisible();
  await expect(page.getByLabel("Nội dung sao lưu")).toContainText("\"funds\"");
});

test("chuyển tháng năm và CRUD quỹ, danh mục", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Luồng quản lý đầy đủ chỉ cần chạy một lần ở desktop.");
  await page.goto("/funds");

  await page.getByRole("button", { name: /Tháng \d+, 2026/ }).click();
  const periodDialog = page.getByRole("dialog", { name: "Chọn tháng và năm" });
  await periodDialog.getByRole("combobox", { name: "Năm" }).click();
  await page.getByRole("option", { name: "2025", exact: true }).click();
  await periodDialog.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Phân bổ theo quỹ — Tháng 1 \/ 2025/ })).toBeVisible();

  await page.getByRole("button", { name: /Quản lý quỹ/ }).click();
  const fundDialog = page.getByRole("dialog", { name: "Quản lý quỹ" });
  await fundDialog.getByPlaceholder("Tên quỹ mới").fill("Quỹ kiểm thử");
  await fundDialog.getByRole("combobox", { name: "Loại quỹ mới" }).click();
  await page.getByRole("option", { name: "Tiết kiệm", exact: true }).click();
  await fundDialog.getByRole("button", { name: "+ Thêm", exact: true }).click();
  const fundName = fundDialog.getByLabel("Tên Quỹ kiểm thử");
  await expect(fundName).toHaveValue("Quỹ kiểm thử");
  await fundName.fill("Quỹ kiểm thử đã đổi");
  await fundName.blur();
  const renamedFund = fundDialog.getByLabel("Tên Quỹ kiểm thử đã đổi");
  page.once("dialog", (dialog) => void dialog.accept());
  await renamedFund.locator("..").getByRole("button", { name: "Xóa" }).click();
  await expect(renamedFund).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Chi tiêu" }).click();
  await page.getByRole("button", { name: /Quản lý danh mục/ }).click();
  const categoryDialog = page.getByRole("dialog", { name: "Quản lý danh mục" });
  const initialCategoryCount = await categoryDialog.locator(".manager-row.category-row").count();
  await categoryDialog.getByPlaceholder("Tên danh mục mới").fill("Danh mục kiểm thử");
  await categoryDialog.getByRole("button", { name: "+ Thêm", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Đã lưu");
  const categoryRow = categoryDialog.locator(".manager-row.category-row").last();
  const categoryName = categoryRow.locator("input").nth(1);
  await expect(categoryName).toHaveValue("Danh mục kiểm thử");
  await categoryName.fill("Danh mục đã đổi");
  await categoryName.blur();
  await expect(categoryName).toHaveValue("Danh mục đã đổi");
  await expect(page.getByRole("status")).toContainText("Đã lưu");
  await categoryRow.getByRole("button", { name: "Xóa" }).click();
  await expect(categoryDialog.locator(".manager-row.category-row")).toHaveCount(initialCategoryCount);
});

test("quản lý tài khoản và gán tài khoản cho giao dịch", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Luồng quản lý đầy đủ chỉ cần chạy một lần ở desktop.");
  await page.getByRole("button", { name: /Quản lý tài khoản/ }).click();
  const accountDialog = page.getByRole("dialog", { name: "Quản lý tài khoản" });
  await accountDialog.getByRole("button", { name: "Loại tài khoản" }).click();
  await accountDialog.getByPlaceholder("Tên loại tài khoản mới").fill("Ví điện tử");
  await accountDialog.getByRole("button", { name: "+ Thêm", exact: true }).click();

  await accountDialog.getByRole("button", { name: "Tài khoản", exact: true }).click();
  await accountDialog.getByPlaceholder("Tên tài khoản mới").fill("VCB kiểm thử");
  await accountDialog.getByRole("combobox", { name: "Loại tài khoản mới" }).click();
  await page.getByRole("option", { name: "Ngân hàng", exact: true }).click();
  await accountDialog.getByRole("button", { name: "+ Thêm", exact: true }).click();
  const accountName = accountDialog.getByLabel("Tên VCB kiểm thử");
  await expect(accountName).toHaveValue("VCB kiểm thử");
  await expect(page.getByRole("status")).toContainText("Đã lưu");
  await page.keyboard.press("Escape");

  await page.getByRole("combobox", { name: "Tài khoản", exact: true }).click();
  await page.getByRole("option", { name: "VCB kiểm thử", exact: true }).click();
  const amount = page.getByRole("textbox", { name: "Số tiền" });
  await amount.fill("250000");
  await amount.blur();
  await page.getByRole("textbox", { name: "Ghi chú", exact: true }).fill("Chi từ VCB");
  await page.getByRole("button", { name: "+ Thêm khoản" }).click();
  await expect(page.locator("tr").filter({ hasText: "Chi từ VCB" })).toContainText("VCB kiểm thử");

  await page.getByRole("combobox", { name: "Tài khoản trong lịch sử" }).click();
  await page.getByRole("option", { name: "VCB kiểm thử", exact: true }).click();
  await expect(page.getByText("Có 1 khoản · 1–1")).toBeVisible();

  await page.getByRole("link", { name: "Thống kê" }).click();
  await expect(page.getByRole("heading", { name: /Chi tiêu theo tài khoản — Năm \d{4}/ })).toBeVisible();
  await expect(page.getByText("VCB kiểm thử", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Chi tiêu" }).click();

  await page.getByRole("button", { name: /Quản lý tài khoản/ }).click();
  const deletedRow = accountDialog.getByLabel("Tên VCB kiểm thử").locator("..");
  await deletedRow.getByRole("button", { name: "Xóa" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("tr").filter({ hasText: "Chi từ VCB" })).toContainText("(đã xóa)");
});

test("holdings cổ phiếu, crypto và biểu đồ mọi năm", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Luồng tài sản đầy đủ chỉ cần chạy một lần ở desktop.");
  await page.goto("/funds");

  const holdings = [
    { fund: "Quỹ đầu tư", ticker: "VNM", quantity: "3", price: "100000", expected: "300,000đ" },
    { fund: "Crypto", ticker: "BTC", quantity: "0.5", price: "2", expected: "25,000đ" },
  ];
  for (const item of holdings) {
    const fundRow = page.locator("tr").filter({ hasText: item.fund });
    await fundRow.getByRole("button", { name: /Chỉnh chi tiết/ }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(item.fund) });
    await dialog.getByRole("button", { name: "+ Thêm giao dịch" }).click();
    await dialog.getByLabel("Mã tài sản 1").fill(item.ticker);
    await dialog.getByRole("spinbutton").fill(item.quantity);
    const manualPrice = dialog.getByRole("textbox", { name: "Giá thủ công 1" });
    await manualPrice.fill(item.price);
    await manualPrice.blur();
    await dialog.getByRole("textbox", { name: "Giá mua 1", exact: true }).fill(item.price);
    await dialog.getByRole("textbox", { name: "Giá mua 1", exact: true }).blur();
    await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(fundRow).toContainText(item.expected);
  }

  await page.getByRole("link", { name: "Thống kê" }).click();
  await page.getByRole("combobox", { name: "Phạm vi" }).click();
  await page.getByRole("option", { name: "Toàn bộ các năm", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Diễn biến tích lũy — Toàn bộ các năm" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Thống kê thu chi — Toàn bộ các năm" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(6);
});

test("xuất file và nhập lại bản sao lưu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Luồng file đầy đủ chỉ cần chạy một lần ở desktop.");
  await page.goto("/funds");
  await page.getByRole("button", { name: /Xuất sao lưu/ }).click();
  const backupDialog = page.getByRole("dialog", { name: "Sao lưu dữ liệu" });
  const content = await backupDialog.getByLabel("Nội dung sao lưu").inputValue();
  const downloadPromise = page.waitForEvent("download");
  await backupDialog.getByRole("button", { name: "Tải bản sao lưu" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^quy-tai-chinh-\d{4}-\d{2}-\d{2}\.json$/);
  await page.keyboard.press("Escape");

  const backup = JSON.parse(content);
  const current = new Date();
  backup.years[String(current.getFullYear())].notes[current.getMonth()] = "Đã khôi phục từ E2E";
  let acceptedDialogs = 0;
  page.on("dialog", (dialog) => {
    acceptedDialogs += 1;
    void dialog.accept();
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "backup-e2e.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect.poll(() => acceptedDialogs).toBe(2);
  await expect(page.getByRole("textbox", { name: "Ghi chú tháng" })).toHaveValue("Đã khôi phục từ E2E");
});

test("giao diện mobile giữ điều hướng và bảng cuộn được", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Chỉ chạy trên viewport mobile.");
  await expect(page.getByRole("navigation", { name: "Điều hướng" })).toBeVisible();
  await page.getByRole("link", { name: "Quỹ" }).click();
  await expect(page.getByRole("heading", { name: /Phân bổ theo quỹ/ })).toBeVisible();
  await page.getByRole("link", { name: "Thống kê" }).click();
  await expect(page.getByRole("heading", { name: /Diễn biến tích lũy/ })).toBeVisible();
});
