const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});


test("OpenUtau server readiness check reports available phonemizers", async ({ page }) => {
  await page.locator("#diagnostics summary").click();
  await page.route("**/health", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }),
  }));
  await page.route("**/api/v1/engine/status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      openUtauRevision: "08222cb7c48c4ab47faa34a6efc34e2c00898a1e",
      enginePrerequisitesReady: true,
      phonemizers: {
        available: ["JapaneseVCVPhonemizer", "JapaneseCVVCPhonemizer"],
        missing: [],
      },
      realVoicebankVerified: false,
    }),
  }));
  await page.locator("#engineStatusCheck").click();
  await expect(page.locator("#engineStatus")).toContainText("接続成功：歌唱サーバー稼働中");
  await expect(page.locator("#engineStatus")).toContainText("JapaneseVCVPhonemizer");
  await expect(page.locator("#engineStatus")).toContainText("実音源の歌声品質");
});

test("main interface loads without uncaught page errors", async ({ page }) => {
  await page.locator("#diagnostics summary").click();
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

test("local analysis mixes stereo channels and reports denser pitch samples", async ({ page }) => {
  const sampleRate = 16000;
  const sampleCount = sampleRate * 1.5;
  const wav = Buffer.alloc(44 + sampleCount * 4);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 4, 40);
  for (let i = 0; i < sampleCount; i++) {
    const right = Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * 220 * i / sampleRate));
    wav.writeInt16LE(0, 44 + i * 4);
    wav.writeInt16LE(right, 46 + i * 4);
  }

  await page.locator("#audioFile").setInputFiles({
    name: "right-channel-tone.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await page.locator("#loadAudio").click();
  await expect(page.locator("#fileInfo")).toContainText("段階4/4 成功", { timeout: 15000 });
  await page.locator("#analyze").click();
  await expect(page.locator("#analysis")).toContainText("解析ベータ完了", { timeout: 15000 });
  await expect(page.locator("#analysis")).toContainText("A3");
  await expect(page.locator("#analysis")).toContainText("入力チャンネル：2ch");
  await expect(page.locator("#analysis")).toContainText("音程サンプル最大600点");
  await expect(page.locator("#analysisToSong")).toBeEnabled();
});

test("local tempo analysis estimates a synthetic 120 BPM click track", async ({ page }) => {
  const sampleRate = 16000;
  const sampleCount = sampleRate * 8;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  const interval = sampleRate / 2;
  const clickLength = Math.floor(sampleRate * 0.015);
  for (let i = 0; i < sampleCount; i++) {
    const phase = i % interval;
    const sample = phase < clickLength
      ? Math.round(0.65 * 32767 * Math.sin(2 * Math.PI * 900 * phase / sampleRate))
      : 0;
    wav.writeInt16LE(sample, 44 + i * 2);
  }

  await page.locator("#audioFile").setInputFiles({
    name: "120-bpm-click.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await page.locator("#loadAudio").click();
  await expect(page.locator("#fileInfo")).toContainText("段階4/4 成功", { timeout: 15000 });
  await page.locator("#analyze").click();
  await expect(page.locator("#analysis")).toContainText("解析ベータ完了", { timeout: 15000 });
  await expect(page.locator("#analysis")).toContainText("120 BPM");
});

test("voicebank creator imports audio and exports a valid oto.ini entry", async ({ page }) => {
  const sampleRate = 44100;
  const sampleCount = sampleRate;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i++) {
    wav.writeInt16LE(Math.round(0.25 * 32767 * Math.sin(2 * Math.PI * 220 * i / sampleRate)), 44 + i * 2);
  }

  await page.locator("#vbCreateAlias").fill("あ");
  await page.locator("#vbCreateFilename").fill("test-a.wav");
  await page.locator("#vbCreateImport").setInputFiles({
    name: "recorded-source.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(page.locator("#vbCreateAdd")).toBeEnabled({ timeout: 15000 });
  await page.locator("#vbCreateAdd").click();
  await expect(page.locator("#vbCreateList")).toContainText("test-a.wav");
  await expect(page.locator("#vbCreateList")).toContainText("あ");
  await expect(page.locator("#vbCreateDownloadOto")).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#vbCreateDownloadOto").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let output = "";
  for await (const chunk of stream) output += chunk.toString("utf8");
  expect(output).toContain("test-a.wav=あ,0.0,100.0,-100.0,80.0,30.0");
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

  await page.locator("#vbClear").click();
  await expect(page.locator("#vbStatus")).toContainText("端末内保存データを削除しました");
  const savedRecord = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("VoiceBankStudioLocalBanks", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("banks", "readonly");
      const get = tx.objectStore("banks").get("active");
      get.onsuccess = () => { resolve(get.result || null); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  }));
  expect(savedRecord).toBeNull();
  const cleared = await page.evaluate(() => window.VoiceBankStudioVoicebank.getStatus());
  expect(cleared.zipLoaded).toBe(false);
  expect(cleared.otoEntries).toBe(0);
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



test("singing can be force-cancelled while the voicebank upload is active", async ({ page }) => {
  const zipPath = path.join(__dirname, "fixtures", "test-voicebank.zip");
  let registrationStartedResolve;
  const registrationStarted = new Promise(resolve => { registrationStartedResolve = resolve; });
  await page.route("**/api/v1/voicebanks/register", async route => {
    registrationStartedResolve();
    await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ archiveId: "cancel-test-voicebank" }),
      });
    } catch (_) {}
  });
  await page.locator("#vbZip").setInputFiles(zipPath);
  await expect(page.locator("#vbStatus")).toContainText("読み込み完了", { timeout: 15000 });
  await page.locator("#confirmVoicePlay").check();
  await page.locator("#voicePlay").click();
  await registrationStarted;
  await expect(page.locator("#cancelVoiceRender")).toBeVisible();
  await page.locator("#cancelVoiceRender").click();
  await expect(page.locator("#voicePlayStatus")).toContainText("ブラウザからの通信を切断しました");
  await expect(page.locator("#confirmVoicePlay")).not.toBeChecked();
  await expect(page.locator("#voicePlay")).toBeDisabled();
});


test("singing render request can be force-cancelled", async ({ page }) => {
  const zipPath = path.join(__dirname, "fixtures", "test-voicebank.zip");
  let renderStartedResolve, releaseRenderResolve;
  const renderStarted = new Promise(resolve => { renderStartedResolve = resolve; });
  const renderHeld = new Promise(resolve => { releaseRenderResolve = resolve; });
  await page.route("**/api/v1/voicebanks/register", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ archiveId: "render-cancel-voicebank" }),
  }));
  await page.route("**/api/v1/render", async route => {
    renderStartedResolve();
    await renderHeld;
    try {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.alloc(128) });
    } catch (_) {}
  });
  await page.locator("#vbZip").setInputFiles(zipPath);
  await expect(page.locator("#vbStatus")).toContainText("読み込み完了", { timeout: 15000 });
  await page.locator("#confirmVoicePlay").check();
  await page.locator("#voicePlay").click();
  await renderStarted;
  await expect(page.locator("#cancelVoiceRender")).toBeVisible();
  await page.locator("#cancelVoiceRender").click();
  releaseRenderResolve();
  await expect(page.locator("#voicePlayStatus")).toContainText("ブラウザからの通信を切断しました");
  await expect(page.locator("#confirmVoicePlay")).not.toBeChecked();
  await expect(page.locator("#voicePlay")).toBeDisabled();
});

test("singing UI registers a voicebank and sends the edited score to OpenUtau", async ({ page }) => {
  const zipPath = path.join(__dirname, "fixtures", "test-voicebank.zip");
  const wavPath = path.join(__dirname, "fixtures", "test-tone.wav");
  const renderRequests = [];
  let registerRequests = 0;

  await page.route("**/api/v1/voicebanks/register", async route => {
    registerRequests++;
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

  await expect(page.locator("#voicePlay")).toBeDisabled();
  await page.locator("#confirmVoicePlay").check();
  await expect(page.locator("#voicePlay")).toBeEnabled();
  await page.locator("#confirmVoicePlay").uncheck();
  await expect(page.locator("#voicePlay")).toBeDisabled();

  await page.locator("details.song-editor summary").click();
  await page.locator("#keyShift").fill("0"); // Keep this test focused on the entered MIDI pitch.
  const firstPitch = page.locator("#notes .note").first().locator('input[aria-label="pitch"]');
  await firstPitch.fill("D4");
  await firstPitch.dispatchEvent("change");

  await page.locator("#confirmVoicePlay").check();
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
  const notesField = renderRequests[0].match(/name="notesJson"\r\n\r\n([^\r]+)/)?.[1];
  expect(notesField).toBeTruthy();
  const sentNotes = JSON.parse(notesField);
  expect(sentNotes[0].tone).toBe(62); // D4 remains MIDI 62; no octave offset is applied.
  expect(await page.locator("#octave").count()).toBe(0);
  expect(renderRequests[0]).toContain("phonemizer");
  expect(registerRequests).toBe(1);
  expect(await page.evaluate(() => window.VoiceBankStudioVoicebank.getSavedServerArchiveId()))
    .toBe("browser-e2e-voicebank");

  await page.reload();
  await expect(page.locator("#vbStatus")).toContainText("保存済み音源を復元しました", { timeout: 15000 });
  await expect(page.locator("#confirmVoicePlay")).not.toBeChecked();
  await page.locator("#confirmVoicePlay").check();
  await page.locator("#voicePlay").click();
  await expect(page.locator("#voicePlayStatus")).toContainText("歌声の生成が完了しました", {
    timeout: 15000,
  });
  expect(registerRequests).toBe(1);
  expect(renderRequests).toHaveLength(2);
});
