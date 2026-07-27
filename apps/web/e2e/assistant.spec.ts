import { expect, test } from "@playwright/test";

test("trợ lý chỉ ghi khoản chi sau khi xác nhận", async ({ page }) => {
  await page.goto("/__test/login");
  await expect(page.getByRole("heading", { name: "Theo dõi chi tiêu" })).toBeVisible();

  await page.getByRole("button", { name: "Mở trợ lý tài chính" }).click();
  await page.getByRole("textbox", { name: "Nhắn cho trợ lý" }).fill("50k ăn sáng");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();

  await expect(page.getByText("Mình đã chuẩn bị khoản chi. Hãy kiểm tra rồi xác nhận.")).toBeVisible();
  await expect(page.getByLabel("Bản xem trước hành động").getByText("50,000đ")).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByText("Đã ghi khoản thu chi thành công.")).toBeVisible();
  await expect(page.getByText("Đã xác nhận")).toBeVisible();
});
