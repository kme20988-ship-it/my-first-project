"use client";

import { useMemo, useRef, useState } from "react";

const MAX_FILES_DEFAULT = 30;
const MAX_DIM_DEFAULT = 1920;

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = reject;
    img.src = url;
  });
}

async function fileToResizedDataURL(file, maxDim = MAX_DIM_DEFAULT, quality = 0.9) {
  const { img, url } = await loadImage(file);
  try {
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;

    const scale = Math.min(1, maxDim / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    const isPng = (file.type || "").includes("png");
    const mime = isPng ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(mime, isPng ? undefined : quality);

    return { dataUrl, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Home() {
  const [items, setItems] = useState([]); // {id, file, name, size, previewUrl}
  const [ratio, setRatio] = useState("16:9");
  const [layout, setLayout] = useState("cover");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [maxFiles, setMaxFiles] = useState(MAX_FILES_DEFAULT);
  const [maxDim, setMaxDim] = useState(MAX_DIM_DEFAULT);

  const [titleSlide, setTitleSlide] = useState(true);
  const [titleText, setTitleText] = useState("写真スライド");
  const [splitEvery, setSplitEvery] = useState(0);

  const dragFrom = useRef(null);

  const total = items.length;
  const totalBytes = useMemo(() => items.reduce((s, it) => s + (it.size || 0), 0), [items]);

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => (f.type || "").startsWith("image/"));
    if (!files.length) return;

    setMsg("");
    setItems((prev) => {
      const next = [...prev];

      for (const f of files) {
        if (next.length >= maxFiles) break;
        const id = `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(16).slice(2)}`;
        const previewUrl = URL.createObjectURL(f);
        next.push({ id, file: f, name: f.name, size: f.size, previewUrl });
      }

      if (files.length && next.length >= maxFiles) {
        setMsg(`上限は${maxFiles}枚です。追加したい場合は上限を増やしてください。`);
      }

      return next;
    });
  }

  function onPick(e) {
    addFiles(e.target.files);
    e.target.value = "";
  }

  function removeAt(i) {
    setItems((prev) => {
      const target = prev[i];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  function clearAll() {
    setItems((prev) => {
      for (const it of prev) {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      }
      return [];
    });
    setMsg("");
  }

  function onDragStart(i) {
    dragFrom.current = i;
  }

  function onDragOver(e) {
    e.preventDefault();
  }

  function onDrop(i) {
    const from = dragFrom.current;
    if (from === null || from === undefined || from === i) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      return next;
    });
    dragFrom.current = null;
  }

  async function build() {
    if (!items.length || busy) return;

    setBusy(true);
    setMsg("");
    setProgress({ done: 0, total: items.length });

    try {
      const images = [];
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const resized = await fileToResizedDataURL(it.file, maxDim, 0.9);
        images.push({
          name: it.name,
          dataUrl: resized.dataUrl,
          width: resized.width,
          height: resized.height,
        });
        setProgress({ done: idx + 1, total: items.length });
      }

      const res = await fetch("/api/pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images,
          ratio,
          layout,
          titleSlide,
          titleText,
          splitEvery: Number(splitEvery) || 0,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const contentType = res.headers.get("content-type") || "";
      const blob = await res.blob();

      const isZip = contentType.includes("zip");
      const filename = isZip ? "photos.zip" : "photos.pptx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg(e?.message || "エラーが発生しました");
    } finally {
      setBusy(false);
      setProgress({ done: 0, total: 0 });
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "36px auto", padding: 16, fontFamily: "system-ui, -apple-system" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>写真をPowerPointに変換</h1>
      <p style={{ marginTop: 10, opacity: 0.8, lineHeight: 1.6 }}>
        画像を並べ替えて、PPTXを自動生成します。アップロードした画像はサーバに保存しません（生成処理にのみ使用）。
      </p>

      <section style={{ marginTop: 18, padding: 14, border: "1px solid #e5e5e5", borderRadius: 14 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 6 }}>
            比率
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              <option value="16:9">16:9（ワイド）</option>
              <option value="4:3">4:3</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            レイアウト
            <select value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="cover">全面表示（中央トリミング）</option>
              <option value="fit">全体が見える（余白あり）</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            上限枚数
            <input
              type="number"
              min={1}
              max={300}
              value={maxFiles}
              onChange={(e) => setMaxFiles(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 110 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            最大辺（縮小）
            <input
              type="number"
              min={640}
              max={4096}
              value={maxDim}
              onChange={(e) => setMaxDim(Math.max(640, Number(e.target.value) || 640))}
              style={{ width: 130 }}
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 20 }}>
            <input type="checkbox" checked={titleSlide} onChange={(e) => setTitleSlide(e.target.checked)} />
            タイトルスライドを入れる
          </label>

          {titleSlide && (
            <label style={{ display: "grid", gap: 6 }}>
              タイトル
              <input value={titleText} onChange={(e) => setTitleText(e.target.value)} placeholder="例）写真スライド" />
            </label>
          )}

          <label style={{ display: "grid", gap: 6 }}>
            分割（任意）
            <select value={splitEvery} onChange={(e) => setSplitEvery(Number(e.target.value))}>
              <option value={0}>分割しない（pptx）</option>
              <option value={10}>10枚ごと（zip）</option>
              <option value={20}>20枚ごと（zip）</option>
              <option value={30}>30枚ごと（zip）</option>
              <option value={50}>50枚ごと（zip）</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            画像を追加
            <input type="file" accept="image/*" multiple onChange={onPick} />
          </label>

          <button
            onClick={build}
            disabled={!total || busy}
            style={{
              marginLeft: "auto",
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid #ddd",
              background: busy || !total ? "#f5f5f5" : "white",
              cursor: busy || !total ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {busy ? "作成中..." : `生成してダウンロード（${total}枚）`}
          </button>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", opacity: 0.85 }}>
          <span>選択合計: {total}枚</span>
          <span>元サイズ合計: {fmtBytes(totalBytes)}</span>
          <button onClick={clearAll} disabled={!total || busy}>
            すべてクリア
          </button>
        </div>

        {busy && progress.total > 0 && (
          <div style={{ marginTop: 10, opacity: 0.9 }}>
            画像準備: {progress.done}/{progress.total}
          </div>
        )}

        {msg && (
          <div style={{ marginTop: 10, color: "#b00020", whiteSpace: "pre-wrap" }}>
            {msg}
          </div>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
          画像一覧（ドラッグで順番変更）
        </h2>

        {total === 0 ? (
          <div
            onDragOver={onDragOver}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
            style={{
              border: "2px dashed #ddd",
              borderRadius: 14,
              padding: 24,
              opacity: 0.85,
            }}
          >
            ここに画像をドラッグ＆ドロップでも追加できます
          </div>
        ) : (
          <ol style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 8 }}>
            {items.map((it, i) => (
              <li
                key={it.id}
                draggable={!busy}
                onDragStart={() => onDragStart(i)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(i)}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 10px",
                  border: "1px solid #eee",
                  borderRadius: 12,
                  background: "#fff",
                }}
                title="ドラッグして順番を変更"
              >
                <span style={{ width: 22, opacity: 0.7 }}>{i + 1}</span>
                <img
                  src={it.previewUrl}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: "cover",
                    borderRadius: 10,
                    border: "1px solid #eee",
                    flex: "0 0 auto",
                  }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.name}
                </span>
                <span style={{ opacity: 0.7 }}>{fmtBytes(it.size)}</span>
                <button onClick={() => removeAt(i)} disabled={busy}>
                  削除
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer style={{ marginTop: 26, fontSize: 13, opacity: 0.75, lineHeight: 1.8 }}>
        <div>
          注意: 大量・超高解像度の画像は端末や環境により時間がかかることがあります。うまくいかない場合は「最大辺（縮小）」を小さくするか、「分割」を使ってください。
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a href="/terms">利用規約</a>
          <a href="/privacy">プライバシー</a>
          <span>個人運営・連絡先非公開</span>
        </div>
      </footer>
    </main>
  );
}
