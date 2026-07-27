import { expect, test } from "@playwright/test";

test("trợ lý chỉ ghi batch khoản chi sau khi xác nhận", async ({ page }) => {
  await page.goto("/__test/login");
  await expect(page.getByRole("heading", { name: "Theo dõi chi tiêu" })).toBeVisible();

  await page.getByRole("button", { name: "Mở trợ lý tài chính" }).click();
  await page.getByRole("textbox", { name: "Nhắn cho trợ lý" }).fill("30k ăn sáng và 45k kem đánh răng");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();

  await expect(page.getByText("Mình đã chuẩn bị 2 khoản chi. Hãy kiểm tra rồi xác nhận.")).toBeVisible();
  const preview = page.getByLabel("Bản xem trước hành động");
  await expect(preview.getByText("2 thao tác")).toBeVisible();
  await expect(preview.getByText("30,000đ")).toBeVisible();
  await expect(preview.getByText("45,000đ")).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByText("Đã ghi 2 thao tác thành công (2 khoản thu/chi, 0 lần trích quỹ).")).toBeVisible();
  await expect(page.getByText("Đã xác nhận")).toBeVisible();
});
