const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("main interface loads without uncaught page errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.locator("#notes .note")).toHaveCount(42);
  await expect(page.locator("#worldlineWasmTest")).toBeVisible();
  await expect(page.locator("#voicePlay")).toBeVisible();
  expect(errors).toEqual([]);
});

test("score notes can be added, edited, and deleted", async ({ page }) => {
  await page.locator("details.song-editor summary").click();
  const initial = await page.locator("#notes .note").count();
  await page.locator("#add").click();
  await expect(page.locator("#notes .note")).toHaveCount(initial + 1);
  const last = page.locator("#notes .note").last();
  await last.locator('input[aria-label="pitch"]').fill("D4");
  await last.locator('input[aria-label="pitch"]').dispatchEvent("change");
  await expect(last.locator('input[aria-label="pitch"]')).toHaveValue("D4");
  await last.locator('button[title="この音符を削除"]').click();
  await expect(page.locator("#notes .note")).toHaveCount(initial);
});

test("project JSON can be exported and imported", async ({ page }) => {
  await page.locator("#bpm").fill("128");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("VoiceBankStudio-project.json");
  const filePath = await download.path();
  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  expect(saved.bpm).toBe(128);
  expect(saved).not.toHaveProperty("octave");
  expect(saved.notes.length).toBe(42);
  const imported = { ...saved, bpm: 136, notes: saved.notes.slice(0, 2) };
  const importPath = path.join(__dirname, "fixtures", "roundtrip-project.json");
  fs.writeFileSync(importPath, JSON.stringify(imported));
  await page.locator("#load").setInputFiles(importPath);
  await expect(page.locator("#bpm")).toHaveValue("136");
  await expect(page.locator("#notes .note")).toHaveCount(2);
  await expect(page.locator("#msg")).toContainText("プロジェクトを読み込みました");
});

test("local audio import and analysis work with a WAV fixture", async ({ page }) => {
  const wavPath = path.join(__dirname, "fixtures", "test-tone.wav");
  await page.locator("#audioFile").setInputFiles(wavPath);
  await page.locator("#loadAudio").click();
  await expect(page.locator("#fileInfo")).toContainText("段階4/4 成功", { timeout: 15000 });
  await expect(page.locator("#analysis")).toContainText("読み込み完了", { timeout: 15000 });
  await expect(page.locator("#analyze")).toBeEnabled();
  await page.locator("#analyze").click();
  await expect(page.locator("#analysis")).toContainText("解析ベータ完了", { timeout: 15000 });
  await expect(page.locator("#analysisToSong")).toBeEnabled();
  await page.locator("#analysisToSong").click();
  await expect(page.locator("#msg")).toContainText("仮メロディ");
});

test("voicebank ZIP loads oto.ini aliases and exposes valid WAV preview", async ({ page }) => {
  const zipPath = path.join(__dirname, "fixtures", "test-voicebank.zip");
  await page.locator("#vbZip").setInputFiles(zipPath);
  await expect(page.locator("#vbStatus")).toContainText("読み込み完了", { timeout: 15000 });
  await expect(page.locator("#vbRows .vb-entry")).toHaveCount(2);
  await expect(page.locator("#vbRows .vb-entry button").first()).toBeEnabled();
  const api = await page.evaluate(() => window.VoiceBankStudioVoicebank.getStatus());
  expect(api.otoEntries).toBe(2);
  expect(api.zipLoaded).toBe(true);
  await expect(page.locator("#vbStatus")).toContainText("端末内保存完了", { timeout: 15000 });
  await page.reload();
  await expect(page.locator("#vbStatus")).toContainText("保存済み音源を復元しました", { timeout: 15000 });
  const restored = await page.evaluate(() => window.VoiceBankStudioVoicebank.getStatus());
  expect(restored.otoEntries).toBe(2);
  expect(restored.zipLoaded).toBe(true);
});

test("video URL registration validates service and enables preview", async ({ page }) => {
  await page.locator("#sourceUrl").fill("https://youtu.be/_zOyL7yH9Vo");
  await page.locator("#registerUrl").click();
  await expect(page.locator("#urlStatus")).toContainText("YouTubeのURLを登録しました");
  await expect(page.locator("#previewUrl")).toBeEnabled();
  await page.locator("#previewUrl").click();
  await expect(page.locator("#videoPreview")).toBeVisible();
  await expect(page.locator("#youtubeFrame")).toHaveAttribute("src", /youtube-nocookie\.com\/embed/);
});


test("singing UI registers a voicebank and sends the edited score to OpenUtau", async ({ page }) => {
  const zipPath = path.join(__dirname, "fixtures", "test-voicebank.zip");
  const wavPath = path.join(__dirname, "fixtures", "test-tone.wav");
  const renderRequests = [];

  await page.route("**/api/v1/voicebanks/register", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ archiveId: "browser-e2e-voicebank" }),
    });
  });

  await page.route("**/api/v1/render", async route => {
    renderRequests.push(route.request().postData() || "");
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: fs.readFileSync(wavPath),
    });
  });

  await page.locator("#vbZip").setInputFiles(zipPath);
  await expect(page.locator("#vbStatus")).toContainText("読み込み完了", { timeout: 15000 });

  await page.locator("details.song-editor summary").click();
  const firstPitch = page.locator("#notes .note").first().locator('input[aria-label="pitch"]');
  await firstPitch.fill("D4");
  await firstPitch.dispatchEvent("change");

  await page.locator("#voicePlay").click();
  await expect(page.locator("#voicePlayStatus")).toContainText("歌声の生成が完了しました", {
    timeout: 15000,
  });
  await expect(page.locator("#playRender")).toBeEnabled();
  await expect(page.locator("#downloadRender")).toBeEnabled();

  expect(renderRequests).toHaveLength(1);
  expect(renderRequests[0]).toContain("browser-e2e-voicebank");
  expect(renderRequests[0]).toContain("notesJson");
  expect(renderRequests[0]).toContain('"lyric":"き"');
  const notesField = new URLSearchParams(renderRequests[0]).get("notesJson");
  const sentNotes = JSON.parse(notesField);
  expect(sentNotes[0].tone).toBe(62); // D4 remains MIDI 62; no octave offset is applied.
  expect(await page.locator("#octave").count()).toBe(0);
  expect(renderRequests[0]).toContain("phonemizer");
});
