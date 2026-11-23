(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const status = $("vbCreateStatus");
  if (!status) return;

  const TARGET_RATE = 44100;
  let currentWav = null;
  let currentUrl = null;
  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];
  let entries = [];
  let audioContext = null;

  function setStatus(message) {
    status.textContent = message;
    status.classList.toggle("error", /(エラー|失敗|できません|許可されません)/.test(message));
  }

  function getAudioContext() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error("このブラウザでは音声変換に対応していません。");
    if (!audioContext) audioContext = new Ctor();
    return audioContext;
  }

  function encodeMonoWav(audioBuffer) {
    const sourceRate = audioBuffer.sampleRate;
    const length = Math.max(1, Math.ceil(audioBuffer.duration * TARGET_RATE));
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
    const sampleAt = position => {
      const index = Math.min(sourceRate === TARGET_RATE ? length - 1 : channels[0].length - 1, Math.floor(position));
      const next = Math.min(channels[0].length - 1, index + 1);
      const fraction = position - index;
      let sum = 0;
      for (const channel of channels) {
        const a = channel[index] || 0;
        const b = channel[next] || 0;
        sum += a + (b - a) * fraction;
      }
      return Math.max(-1, Math.min(1, sum / channels.length));
    };
    const bytes = new ArrayBuffer(44 + length * 2);
    const view = new DataView(bytes);
    const write = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, TARGET_RATE, true);
    view.setUint32(28, TARGET_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      const sample = sampleAt(i * sourceRate / TARGET_RATE);
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return new Blob([bytes], { type: "audio/wav" });
  }

  async function toWav(blob) {
    const context = getAudioContext();
    const bytes = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (!decoded.length || !decoded.duration) throw new Error("音声データが空です。");
    return encodeMonoWav(decoded);
  }

  function revokeCurrentUrl() {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }

  async function setCurrentAudio(blob, sourceName) {
    setStatus("音声を44.1kHz・16bit・モノラルWAVに変換しています…");
    try {
      const wav = await toWav(blob);
      currentWav = wav;
      revokeCurrentUrl();
      currentUrl = URL.createObjectURL(wav);
      $("vbCreatePreview").src = currentUrl;
      $("vbCreatePreview").classList.remove("hidden");
      $("vbCreateAdd").disabled = false;
      $("vbCreateDownloadWav").disabled = false;
      const seconds = (wav.size - 44) / (TARGET_RATE * 2);
      setStatus(sourceName + "を読み込みました。44.1kHz / 16bit / モノラル、約" + seconds.toFixed(2) + "秒です。");
    } catch (error) {
      currentWav = null;
      $("vbCreateAdd").disabled = true;
      $("vbCreateDownloadWav").disabled = true;
      setStatus("音声変換エラー：" + (error && error.message ? error.message : String(error)));
    }
  }

  function safeFilename(value) {
    let name = String(value || "").trim().replace(/[\\/:*?"<>|]/g, "_");
    if (!name) name = "voice.wav";
    return name.toLowerCase().endsWith(".wav") ? name : name + ".wav";
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function otoValues() {
    const ids = ["vbOtoOffset", "vbOtoConsonant", "vbOtoCutoff", "vbOtoPreutterance", "vbOtoOverlap"];
    return ids.map(id => {
      const value = Number($(id).value);
      if (!Number.isFinite(value)) throw new Error("原音設定の数値を確認してください。");
      return value;
    });
  }

  function renderEntries() {
    const root = $("vbCreateList");
    root.replaceChildren();
    if (!entries.length) {
      root.textContent = "登録した原音はここに表示されます。";
      $("vbCreateDownloadOto").disabled = true;
      return;
    }
    entries.forEach((entry, index) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--line)";
      const label = document.createElement("span");
      label.textContent = entry.filename + "  /  " + entry.alias;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "WAV保存";
      button.addEventListener("click", () => download(entry.blob, entry.filename));
      row.append(label, button);
      root.appendChild(row);
    });
    $("vbCreateDownloadOto").disabled = false;
  }

  function makeOtoIni() {
    return entries.map(entry => {
      const values = entry.values.map(value => Number(value).toFixed(1)).join(",");
      return entry.filename + "=" + entry.alias + "," + values;
    }).join("\r\n") + "\r\n";
  }

  $("vbCreateImport").addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    if (file) await setCurrentAudio(file, file.name);
    event.target.value = "";
  });

  $("vbCreateRecord").addEventListener("click", async () => {
    const button = $("vbCreateRecord");
    button.disabled = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("このブラウザではマイク録音に対応していません。HTTPSで開き、Safariのマイク許可を確認してください。");
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const preferred = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
      const mimeType = preferred.find(type => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type));
      mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
      chunks = [];
      mediaRecorder.addEventListener("dataavailable", event => {
        if (event.data && event.data.size) chunks.push(event.data);
      });
      mediaRecorder.addEventListener("stop", async () => {
        const recording = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        mediaStream && mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
        mediaRecorder = null;
        $("vbCreateRecord").disabled = false;
        $("vbCreateStop").disabled = true;
        if (recording.size) await setCurrentAudio(recording, "マイク録音");
        else setStatus("録音データがありません。もう一度録音してください。");
      }, { once: true });
      mediaRecorder.start(250);
      $("vbCreateStop").disabled = false;
      setStatus("録音中です。発音が終わったら「録音停止」を押してください。");
    } catch (error) {
      if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
      mediaRecorder = null;
      button.disabled = false;
      setStatus("録音開始エラー：" + (error && error.message ? error.message : String(error)));
    }
  });

  $("vbCreateStop").addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      $("vbCreateStop").disabled = true;
      mediaRecorder.stop();
    }
  });

  $("vbCreateAdd").addEventListener("click", () => {
    if (!currentWav) return;
    const alias = $("vbCreateAlias").value.trim();
    if (!alias) {
      setStatus("エイリアスを入力してください。");
      return;
    }
    try {
      const filename = safeFilename($("vbCreateFilename").value);
      if (entries.some(entry => entry.filename === filename)) throw new Error("同じファイル名が登録済みです。別の名前にしてください。");
      entries.push({ alias, filename, values: otoValues(), blob: currentWav });
      renderEntries();
      setStatus(filename + " を原音リストに追加しました。現在 " + entries.length + " 件です。");
    } catch (error) {
      setStatus("登録エラー：" + error.message);
    }
  });

  $("vbCreateDownloadWav").addEventListener("click", () => {
    if (!currentWav) return;
    download(currentWav, safeFilename($("vbCreateFilename").value));
  });

  $("vbCreateDownloadOto").addEventListener("click", () => {
    if (!entries.length) return;
    const blob = new Blob(["\\uFEFF" + makeOtoIni()], { type: "text/plain;charset=utf-8" });
    download(blob, "oto.ini");
  });

  window.addEventListener("pagehide", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    revokeCurrentUrl();
  });
})();
