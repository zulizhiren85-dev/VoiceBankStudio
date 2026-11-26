const { test, expect } = require("@playwright/test");

test("Worldline WASM runs inside the browser and returns deterministic DSP output", async ({ page }) => {
  await page.goto("/");
  await page.locator("#diagnostics summary").click();
  await expect(page.locator("#worldlineWasmTest")).toBeVisible();
  await page.locator("#worldlineWasmTest").click();
  await expect(page.locator("#worldlineWasmStatus")).toContainText(
    "成功：端末内でF0解析・WORLD合成が完了しました。",
    { timeout: 30000 }
  );
  await expect(page.locator("#worldlineWasmStatus")).toContainText("f0=219.36Hz");
  await expect(page.locator("#worldlineWasmStatus")).toContainText("samples=11001");
});
