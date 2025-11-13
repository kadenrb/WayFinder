/*
  MAP EDITOR — concise overview

  Purpose
  - Display a map image and overlay interactive markers for rooms/doors/POIs.
  - Provide assisted labeling via DB text detection + OCR.

  Core ideas
  - Coordinates are normalized (0..1) relative to the image; zoom uses CSS transform for simplicity.
  - Detection returns text-likelihood boxes; OCR converts selected boxes into room markers.
  - Batch remove tools let you draw a rectangle to delete DB boxes or markers.

  Structure
  - State: markers, zoom, detection controls, progress, selection tools.
  - Helpers: pixel↔normalized conversions, persistence, de‑duplication.
  - Rendering: image, DB boxes, markers, editor card, list.
*/

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ensureDbnet, detectDbnet } from "./detectors/dbnet";

// Point schema
// { id, kind: 'room'|'door'|'poi', poiType?, name?, roomNumber?, x, y }

const POI_TYPES = [
  "washroom",
  "elevator",
  "stairs",
  "ramp",
  "atm",
  "vending",
  "parking",
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function markerClass(kind) {
  switch (kind) {
    case "door":
      return "bg-secondary";
    case "poi":
      return "bg-success";
    case "room":
    default:
      return "bg-primary";
  }
}

export default function MapEditor({ imageSrc }) {
  // Refs (like little mailboxes) to talk to DOM nodes when we need sizes/scrolling
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const spacerRef = useRef(null); // scaled box
  const contentRef = useRef(null); // unscaled content (scaled via CSS transform)
  const imgRef = useRef(null);
  // Markers (rooms/doors/POIs)
  const [points, setPoints] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null); // {id?, xPx, yPx, draft}
  const [drag, setDrag] = useState(null); // {id}
  // Zoom and natural image size
  const [zoom, setZoom] = useState(1);
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });
  // Busy label for long tasks (OCR/DB)
  const [busy, setBusy] = useState("");
  const [pulseId, setPulseId] = useState(null);
  const cancelScanRef = useRef(false);
  // Sort pins nicely (numbers in order). Collator is a fancy sorter.
  const collator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
    []
  );
  // Detector controls
  const [detectorMode, setDetectorMode] = useState("none"); // 'none' | 'db'
  const [progActive, setProgActive] = useState(false);
  const [progPct, setProgPct] = useState(0);
  const [progLabel, setProgLabel] = useState("");
  const lastProgRef = useRef(0);
  // Detector results (boxes outline places where text likely is)
  const [dbBoxes, setDbBoxes] = useState([]); // [{xN,yN,wN,hN,score}]
  // Heatmap debug removed from UI
  // Selection/delete tooling
  const [selectMode, setSelectMode] = useState("none"); // 'none' | 'db' | 'points'
  const [selectRect, setSelectRect] = useState(null); // {x0,y0,x1,y1} in normalized coords
  const [dbThresh, setDbThresh] = useState(0.12);
  const [dbNorm, setDbNorm] = useState("imagenet"); // 'imagenet' | 'raw'
  const [dbBgr, setDbBgr] = useState(false);
  const [dbStride, setDbStride] = useState(32); // 16 or 32
  const [dbSigmoid, setDbSigmoid] = useState(false);
  const [dbForceCh, setDbForceCh] = useState("auto"); // internal only
  const [dbSoftmax, setDbSoftmax] = useState(false);

  const setProgress = (pct, label) => {
    const now = Date.now();
    if (now - lastProgRef.current > 120 || pct === 100 || pct === 0) {
      lastProgRef.current = now;
      setProgPct(Math.max(0, Math.min(100, Math.round(pct))));
      if (label) setProgLabel(label);
    }
  };
  // OCR/Tesseract — single shared worker
  // We keep one worker across scans to avoid repeated WASM initialization.
  // createWorker options in use:
  // - workerPath: script the worker runs
  // - corePath: Tesseract WASM runtime
  // - langPath: where to fetch *.traineddata (English here)
  // The worker logs progress so we can show a simple % indicator.
  const ocrWorkerRef = useRef(null);
  const ocrPrefixRef = useRef("OCR");

  const getOcrWorker = async () => {
    // Use CDN assets to avoid local 404s while we roll back
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src =
          "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/tesseract.min.js";
        s.crossOrigin = "anonymous";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Failed to load OCR library"));
        document.body.appendChild(s);
      });
    }
    if (!ocrWorkerRef.current) {
      const worker = await window.Tesseract.createWorker({
        workerPath:
          "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/worker.min.js",
        corePath:
          "https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js",
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        workerBlobURL: true,
        logger: (m) => {
          if (
            m?.status === "recognizing text" &&
            typeof m.progress === "number"
          ) {
            setBusy(`${ocrPrefixRef.current} ${Math.round(m.progress * 100)}%`);
          }
        },
      });
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      ocrWorkerRef.current = worker;
    }
    return ocrWorkerRef.current;
  };

  useEffect(() => {
    return () => {
      const w = ocrWorkerRef.current;
      if (w && w.terminate) {
        w.terminate().catch(() => {});
        ocrWorkerRef.current = null;
      }
    };
  }, []);
  const [skipExisting, setSkipExisting] = useState(true);
  const [dupRadius, setDupRadius] = useState(0.004);
  // Dedup by label so adjacent different rooms aren't dropped
  const labelKey = (p) =>
    (p.roomNumber || p.name || p.poiType || p.kind || "")
      .toString()
      .replace(/[^A-Za-z0-9-]/g, "")
      .toUpperCase();
  const dedupByLabel = (arr, minDist = 0.006) => {
    const out = [];
    for (const c of arr) {
      const key = labelKey(c);
      if (!key) {
        out.push(c);
        continue;
      }
      if (
        !out.some(
          (d) =>
            labelKey(d) === key && Math.hypot(d.x - c.x, d.y - c.y) < minDist
        )
      )
        out.push(c);
    }
    return out;
  };

  // Skip adding points that match an existing label within a small radius
  // Used by deep/super-deep/refine passes so repeated scans don't create duplicates
  const filterOutExistingSameLabel = (arr, radius) => {
    if (!Array.isArray(arr) || !arr.length) return arr;
    if (!Array.isArray(points) || !points.length) return arr;
    if (!skipExisting) return arr;
    const r = typeof radius === "number" ? radius : dupRadius;
    return arr.filter(
      (c) =>
        !points.some(
          (p) =>
            labelKey(p) === labelKey(c) && Math.hypot(p.x - c.x, p.y - c.y) < r
        )
    );
  };

  // Persist/load per imageSrc
  const storageKey = useMemo(
    () => `wf_map_editor_state:${imageSrc || ""}`,
    [imageSrc]
  );

  useEffect(() => {
    // Load saved state (per image) from localStorage: points + DB boxes
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data?.points)) setPoints(data.points);
        if (Array.isArray(data?.dbBoxes)) setDbBoxes(data.dbBoxes);
      } else {
        setPoints([]);
        setDbBoxes([]);
      }
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    // Save current state (points + DB boxes) so edits and box cleanups persist
    try {
      localStorage.setItem(storageKey, JSON.stringify({ points, dbBoxes }));
    } catch {}
  }, [points, dbBoxes, storageKey]);

  // Must declare hooks before any early returns
  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const { x, y } = toNorm(e.clientX, e.clientY);
      setPoints((prev) =>
        prev.map((p) => (p.id === drag.id ? { ...p, x, y } : p))
      );
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  const onImgLoad = (e) => {
    const w = e.target.naturalWidth;
    const h = e.target.naturalHeight;
    setNatSize({ w, h });
    try {
      const containerW = scrollRef.current?.clientWidth || w;
      const fit = containerW / w;
      setZoom(Math.min(1, Math.max(0.25, fit)));
    } catch {}
  };

  // using CSS transform scaling on a fixed-size content layer; no canvasStyle needed

  const changeZoom = (delta) =>
    setZoom((z) => Math.min(4, Math.max(0.25, +(z + delta).toFixed(2))));

  // Baseline OCR (whole image)
  // Runs Tesseract once on the full image, then keeps only words that
  // match room-number patterns. This is simple but less effective on dense maps.
  const autoDetectRooms = async () => {
    if (!imageSrc) return;
    if (busy) return;
    setBusy("Running OCR (beta)…");
    try {
      const worker = await getOcrWorker();
      ocrPrefixRef.current = "OCR";
      const { data } = await worker.recognize(imageSrc);
      const words = data?.words || [];
      const nw = natSize.w || imgRef.current?.naturalWidth || 1;
      const nh = natSize.h || imgRef.current?.naturalHeight || 1;
      const candidates = [];
      const roomRe = /^(?:[A-Za-z]?\d{2,4}[A-Za-z]?|\d{1,2}[A-Za-z]-?\d{2,4})$/;
      for (const w of words) {
        const t = (w.text || "").replace(/[^A-Za-z0-9\-]/g, "").trim();
        if (!t || t.length < 3) continue;
        if (!roomRe.test(t)) continue;
        const b = w.bbox || w;
        const cx = ((b?.x0 || 0) + (b?.x1 || 0)) / 2 / nw;
        const cy = ((b?.y0 || 0) + (b?.y1 || 0)) / 2 / nh;
        if (cx > 0 && cy > 0 && cx < 1 && cy < 1) {
          candidates.push({
            id: uid(),
            kind: "room",
            roomNumber: t,
            name: "",
            x: cx,
            y: cy,
          });
        }
      }
      const picked = dedupByLabel(candidates, 0.006).slice(0, 800);
      setPoints((prev) => [...prev, ...picked]);
      setBusy(`Added ${picked.length} detected rooms`);
      setTimeout(() => setBusy(""), 2500);
    } catch (err) {
      console.error(err);
      setBusy(`OCR failed: ${err?.message || "Unknown error"}`);
      setTimeout(() => setBusy(""), 2500);
    }
  };

  // Deep scan: tile + upscale + normal/inverted passes with global merge
  // OCR tiling (higher recall)
  // Splits the image into tiles with overlap and upscales them to improve
  // text legibility for Tesseract. Runs normal + inverted passes and merges results.
  const deepScanRooms = async () => {
    if (!imageSrc || !natSize.w || !natSize.h) return;
    if (busy) return;
    cancelScanRef.current = false;
    try {
      setProgActive(true);
      setProgress(0, "Preparing…");
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src =
            "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/tesseract.min.js";
          s.crossOrigin = "anonymous";
          s.onload = resolve;
          s.onerror = () => reject(new Error("Failed to load OCR library"));
          document.body.appendChild(s);
        });
      }
      const ocrOptsBase = {
        workerPath:
          "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/worker.min.js",
        corePath:
          "https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js",
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        logger: (m) => {
          if (
            m?.status === "recognizing text" &&
            typeof m.progress === "number"
          ) {
            setBusy(`Deep OCR ${Math.round(m.progress * 100)}%`);
          }
        },
      };

      const tilesX = 4,
        tilesY = 4; // 4x4 grid for higher recall
      const overlap = 0.07; // 7% overlap to avoid cutting labels
      const scale = 3; // stronger upsample per tile
      const w = natSize.w,
        h = natSize.h;
      const stepX = Math.floor(w / tilesX);
      const stepY = Math.floor(h / tilesY);
      const ox = Math.floor(stepX * overlap);
      const oy = Math.floor(stepY * overlap);

      const makeTileUrl = (sx, sy, sw, sh, invert = false) => {
        const c = document.createElement("canvas");
        c.width = sw * scale;
        c.height = sh * scale;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // draw source image region
        // To draw, we need the image element loaded. Use an offscreen image.
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
            if (invert) {
              const id = ctx.getImageData(0, 0, c.width, c.height);
              const d = id.data;
              for (let i = 0; i < d.length; i += 4) {
                d[i] = 255 - d[i];
                d[i + 1] = 255 - d[i + 1];
                d[i + 2] = 255 - d[i + 2];
              }
              ctx.putImageData(id, 0, 0);
            }
            resolve(c.toDataURL("image/png"));
          };
          img.onerror = () => reject(new Error("Tile image load failed"));
          img.src = imageSrc;
        });
      };

      const processWords = (words, tile) => {
        const { sx, sy } = tile; // unscaled tile origin
        const candidates = [];
        const roomRe =
          /^(?:[A-Za-z]?\d{2,4}[A-Za-z]?|\d{1,2}[A-Za-z]-?\d{2,4})$/;
        for (let i = 0; i < words.length; i++) {
          const w0 = words[i];
          const tRaw = (w0.text || "").toUpperCase();
          let t = tRaw.replace(/[^A-Z0-9-]/g, "").trim();
          if (!t) continue;
          // Attempt merge with following single-letter token if adjacent
          if (/^\d{2,4}$/.test(t) && i + 1 < words.length) {
            const n = words[i + 1];
            const nRaw = (n.text || "")
              .toUpperCase()
              .replace(/[^A-Z0-9-]/g, "");
            if (/^[A-Z]$/.test(nRaw)) {
              const dx = Math.abs(
                (n.bbox?.x0 || n.x0 || 0) - (w0.bbox?.x1 || w0.x1 || 0)
              );
              const dy = Math.abs(
                (n.bbox?.y0 || n.y0 || 0) - (w0.bbox?.y0 || w0.y0 || 0)
              );
              if (dx < 40 && dy < 25) {
                // in scaled pixels; loose threshold
                // merged bbox
                const bx0 = Math.min(
                  w0.bbox?.x0 || w0.x0 || 0,
                  n.bbox?.x0 || n.x0 || 0
                );
                const by0 = Math.min(
                  w0.bbox?.y0 || w0.y0 || 0,
                  n.bbox?.y0 || n.y0 || 0
                );
                const bx1 = Math.max(
                  w0.bbox?.x1 || w0.x1 || 0,
                  n.bbox?.x1 || n.x1 || 0
                );
                const by1 = Math.max(
                  w0.bbox?.y1 || w0.y1 || 0,
                  n.bbox?.y1 || n.y1 || 0
                );
                const cx = (bx0 + bx1) / 2 / scale; // back to unscaled tile px
                const cy = (by0 + by1) / 2 / scale;
                const ux = (sx + cx) / w; // normalize to full image
                const uy = (sy + cy) / h;
                candidates.push({
                  id: uid(),
                  kind: "room",
                  roomNumber: t + nRaw,
                  name: "",
                  x: ux,
                  y: uy,
                });
                i++; // skip next
                continue;
              }
            }
          }
          if (!t || t.length < 3) continue;
          if (!roomRe.test(t)) continue;
          const b = w0.bbox || w0;
          const cx = ((b?.x0 || 0) + (b?.x1 || 0)) / 2 / scale; // unscaled tile px
          const cy = ((b?.y0 || 0) + (b?.y1 || 0)) / 2 / scale;
          const ux = (sx + cx) / w;
          const uy = (sy + cy) / h;
          if (ux > 0 && uy > 0 && ux < 1 && uy < 1) {
            candidates.push({
              id: uid(),
              kind: "room",
              roomNumber: t,
              name: "",
              x: ux,
              y: uy,
            });
          }
        }
        return candidates;
      };

      const all = [];
      let tileIndex = 0;
      const totalTiles = tilesX * tilesY * 2; // two passes each
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          if (cancelScanRef.current) throw new Error("Canceled");
          const sx0 = Math.max(0, tx * stepX - ox);
          const sy0 = Math.max(0, ty * stepY - oy);
          const sx1 = Math.min(w, (tx + 1) * stepX + ox);
          const sy1 = Math.min(h, (ty + 1) * stepY + oy);
          const sw = Math.max(1, sx1 - sx0);
          const sh = Math.max(1, sy1 - sy0);
          const tile = { sx: sx0, sy: sy0, sw, sh };

          let usedDetector = false;
          if (detectorMode === "db" && (await ensureDbnet())) {
            usedDetector = true;
            const urlA = await makeTileUrl(sx0, sy0, sw, sh, false);
            const urlB = await makeTileUrl(sx0, sy0, sw, sh, true);
            const boxesA = await detectDbnet(urlA, { maxSide: 1536 });
            const boxesB = await detectDbnet(urlB, { maxSide: 1536 });
            const boxes = [...(boxesA || []), ...(boxesB || [])];
            const tileCanvas = document.createElement("canvas");
            const img = await new Promise((resolve, reject) => {
              const i = new Image();
              i.crossOrigin = "anonymous";
              i.onload = () => resolve(i);
              i.onerror = () => reject(new Error("tile load"));
              i.src = urlA;
            });
            tileCanvas.width = img.naturalWidth || img.width;
            tileCanvas.height = img.naturalHeight || img.height;
            tileCanvas.getContext("2d").drawImage(img, 0, 0);
            const total = boxes.length || 1;
            let done = 0;
            for (const b of boxes) {
              done += 1;
              setBusy(`Deep OCR (DB): ${done}/${total}`);
              setProgress(
                Math.round((done * 100) / total),
                `Deep OCR (DB): ${done}/${total}`
              );
              const pad = 4;
              const sx = Math.max(0, Math.round(b.x) - pad);
              const sy = Math.max(0, Math.round(b.y) - pad);
              const swc = Math.max(1, Math.round(b.w) + pad * 2);
              const shc = Math.max(1, Math.round(b.h) + pad * 2);
              const c = document.createElement("canvas");
              c.width = swc * 2;
              c.height = shc * 2; // 2x upscale for OCR
              const ctx = c.getContext("2d");
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.drawImage(
                tileCanvas,
                sx,
                sy,
                swc,
                shc,
                0,
                0,
                swc * 2,
                shc * 2
              );
              const cropUrl = c.toDataURL("image/png");
              const res = await window.Tesseract.recognize(cropUrl, "eng", {
                ...ocrOptsBase,
                tessedit_char_whitelist:
                  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-",
                tessedit_pageseg_mode: "7",
              });
              const raw = (res?.data?.text || "")
                .toUpperCase()
                .replace(/[^A-Z0-9-]/g, "")
                .trim();
              if (!raw) continue;
              // Simple fuzzy fix in digit runs
              const norm = raw
                .replace(/O/g, "0")
                .replace(/B/g, "8")
                .replace(/[IL]/g, "1");
              const roomRe =
                /^(?:[A-Z]?\d{2,4}[A-Z]?|\d{1,2}[A-Z]-?\d{2,4}|\d{3,4}[A-Z]-?\d{1,2})$/;
              if (!roomRe.test(norm)) continue;
              // Center of the DB box mapped to image space
              const cxScaled = sx + swc / 2;
              const cyScaled = sy + shc / 2;
              const cxUnscaled = cxScaled / scale;
              const cyUnscaled = cyScaled / scale;
              const ux = (sx0 + cxUnscaled) / w;
              const uy = (sy0 + cyUnscaled) / h;
              if (ux > 0 && uy > 0 && ux < 1 && uy < 1) {
                all.push({
                  id: uid(),
                  kind: "room",
                  roomNumber: norm,
                  name: "",
                  x: ux,
                  y: uy,
                });
              }
            }
          }
          if (!usedDetector) {
            // Fallback: normal + inverted passes for the entire tile
            tileIndex += 1;
            setBusy(`Deep OCR: tile ${tileIndex}/${totalTiles}`);
            setProgress(
              Math.round((tileIndex * 100) / totalTiles),
              `Deep OCR: tile ${tileIndex}/${totalTiles}`
            );
            const urlA = await makeTileUrl(sx0, sy0, sw, sh, false);
            const resA = await window.Tesseract.recognize(
              urlA,
              "eng",
              ocrOptsBase
            );
            all.push(...processWords(resA?.data?.words || [], tile));

            if (cancelScanRef.current) throw new Error("Canceled");
            tileIndex += 1;
            setBusy(`Deep OCR: tile ${tileIndex}/${totalTiles}`);
            setProgress(
              Math.round((tileIndex * 100) / totalTiles),
              `Deep OCR: tile ${tileIndex}/${totalTiles}`
            );
            const urlB = await makeTileUrl(sx0, sy0, sw, sh, true);
            const resB = await window.Tesseract.recognize(
              urlB,
              "eng",
              ocrOptsBase
            );
            all.push(...processWords(resB?.data?.words || [], tile));
          }
        }
      }

      // Global dedup by label
      const byLabel = dedupByLabel(all, 0.005);
      const filtered = filterOutExistingSameLabel(byLabel);
      setPoints((prev) => [...prev, ...filtered]);
      setBusy(`Deep OCR: added ${filtered.length}`);
      setProgress(100, "Deep OCR complete");
      setTimeout(() => setBusy(""), 2500);
    } catch (err) {
      if (err?.message === "Canceled") {
        setBusy("");
        return;
      }
      console.error(err);
      setBusy(`Deep OCR failed: ${err?.message || "Unknown error"}`);
      setTimeout(() => setBusy(""), 2500);
    }
    setTimeout(() => {
      setProgActive(false);
      setProgress(0, "");
    }, 600);
  };

  // Super deep scan: 8x8 tiles, heavier upscale
  // Denser OCR tiling (max recall)
  // Same as deep scan but with an 8x8 grid. Use when you are OK with longer runtime.
  const superDeepScanRooms = async () => {
    if (!imageSrc || !natSize.w || !natSize.h) return;
    if (busy) return;
    cancelScanRef.current = false;
    try {
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src =
            "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/tesseract.min.js";
          s.crossOrigin = "anonymous";
          s.onload = resolve;
          s.onerror = () => reject(new Error("Failed to load OCR library"));
          document.body.appendChild(s);
        });
      }
      const ocrOptsBase = {
        workerPath:
          "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/worker.min.js",
        corePath:
          "https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js",
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        logger: (m) => {
          if (
            m?.status === "recognizing text" &&
            typeof m.progress === "number"
          ) {
            setBusy(`Super Deep OCR ${Math.round(m.progress * 100)}%`);
          }
        },
      };

      const tilesX = 8,
        tilesY = 8; // 8x8 grid
      const overlap = 0.08; // 8% overlap
      const scale = 3; // strong upsample
      const w = natSize.w,
        h = natSize.h;
      const stepX = Math.floor(w / tilesX);
      const stepY = Math.floor(h / tilesY);
      const ox = Math.floor(stepX * overlap);
      const oy = Math.floor(stepY * overlap);

      const makeTileUrl = (sx, sy, sw, sh, invert = false) => {
        const c = document.createElement("canvas");
        c.width = sw * scale;
        c.height = sh * scale;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
            if (invert) {
              const id = ctx.getImageData(0, 0, c.width, c.height);
              const d = id.data;
              for (let i = 0; i < d.length; i += 4) {
                d[i] = 255 - d[i];
                d[i + 1] = 255 - d[i + 1];
                d[i + 2] = 255 - d[i + 2];
              }
              ctx.putImageData(id, 0, 0);
            }
            resolve(c.toDataURL("image/png"));
          };
          img.onerror = () => reject(new Error("Tile image load failed"));
          img.src = imageSrc;
        });
      };

      const processWords = (words, tile) => {
        const { sx, sy } = tile;
        const candidates = [];
        const roomRe =
          /^(?:[A-Za-z]?\d{2,4}[A-Za-z]?|\d{1,2}[A-Za-z]-?\d{2,4})$/;
        for (let i = 0; i < words.length; i++) {
          const w0 = words[i];
          const tRaw = (w0.text || "").toUpperCase();
          let t = tRaw.replace(/[^A-Z0-9-]/g, "").trim();
          if (!t) continue;
          if (/^\d{2,4}$/.test(t) && i + 1 < words.length) {
            const n = words[i + 1];
            const nRaw = (n.text || "")
              .toUpperCase()
              .replace(/[^A-Z0-9-]/g, "");
            if (/^[A-Z]$/.test(nRaw)) {
              const dx = Math.abs(
                (n.bbox?.x0 || n.x0 || 0) - (w0.bbox?.x1 || w0.x1 || 0)
              );
              const dy = Math.abs(
                (n.bbox?.y0 || n.y0 || 0) - (w0.bbox?.y0 || w0.y0 || 0)
              );
              if (dx < 40 && dy < 25) {
                const bx0 = Math.min(
                  w0.bbox?.x0 || w0.x0 || 0,
                  n.bbox?.x0 || n.x0 || 0
                );
                const by0 = Math.min(
                  w0.bbox?.y0 || w0.y0 || 0,
                  n.bbox?.y0 || n.y0 || 0
                );
                const bx1 = Math.max(
                  w0.bbox?.x1 || w0.x1 || 0,
                  n.bbox?.x1 || n.x1 || 0
                );
                const by1 = Math.max(
                  w0.bbox?.y1 || w0.y1 || 0,
                  n.bbox?.y1 || n.y1 || 0
                );
                const cx = (bx0 + bx1) / 2 / scale;
                const cy = (by0 + by1) / 2 / scale;
                const ux = (sx + cx) / w;
                const uy = (sy + cy) / h;
                candidates.push({
                  id: uid(),
                  kind: "room",
                  roomNumber: t + nRaw,
                  name: "",
                  x: ux,
                  y: uy,
                });
                i++;
                continue;
              }
            }
          }
          if (!t || t.length < 3) continue;
          if (!roomRe.test(t)) continue;
          const b = w0.bbox || w0;
          const cx = ((b?.x0 || 0) + (b?.x1 || 0)) / 2 / scale;
          const cy = ((b?.y0 || 0) + (b?.y1 || 0)) / 2 / scale;
          const ux = (sx + cx) / w;
          const uy = (sy + cy) / h;
          if (ux > 0 && uy > 0 && ux < 1 && uy < 1) {
            candidates.push({
              id: uid(),
              kind: "room",
              roomNumber: t,
              name: "",
              x: ux,
              y: uy,
            });
          }
        }
        return candidates;
      };

      const all = [];
      let tileIndex = 0;
      const totalTiles = tilesX * tilesY * 2;
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          if (cancelScanRef.current) throw new Error("Canceled");
          const sx0 = Math.max(0, tx * stepX - ox);
          const sy0 = Math.max(0, ty * stepY - oy);
          const sx1 = Math.min(w, (tx + 1) * stepX + ox);
          const sy1 = Math.min(h, (ty + 1) * stepY + oy);
          const sw = Math.max(1, sx1 - sx0);
          const sh = Math.max(1, sy1 - sy0);
          const tile = { sx: sx0, sy: sy0, sw, sh };

          tileIndex += 1;
          let usedDetector = false;
          if (detectorMode === "db" && (await ensureDbnet())) {
            const urlA = await makeTileUrl(sx0, sy0, sw, sh, false);
            tileIndex += 1;
            setBusy(`Super Deep OCR: tile ${tileIndex}/${totalTiles} (DB)`);
            const urlB = await makeTileUrl(sx0, sy0, sw, sh, true);
            const boxesA = await detectDbnet(urlA, { maxSide: 1536 });
            const boxesB = await detectDbnet(urlB, { maxSide: 1536 });
            const boxes = [...(boxesA || []), ...(boxesB || [])];
            if (boxes && boxes.length) {
              usedDetector = true;
              const tileCanvas = document.createElement("canvas");
              const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.crossOrigin = "anonymous";
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error("tile load"));
                i.src = urlA;
              });
              tileCanvas.width = img.naturalWidth || img.width;
              tileCanvas.height = img.naturalHeight || img.height;
              tileCanvas.getContext("2d").drawImage(img, 0, 0);
              let done = 0;
              const total = boxes.length;
              for (const b of boxes) {
                done += 1;
                setBusy(`Super Deep OCR (DB): ${done}/${total}`);
                const pad = 4;
                const sx = Math.max(0, Math.round(b.x) - pad),
                  sy = Math.max(0, Math.round(b.y) - pad);
                const swc = Math.max(1, Math.round(b.w) + pad * 2),
                  shc = Math.max(1, Math.round(b.h) + pad * 2);
                const c = document.createElement("canvas");
                c.width = swc * 2;
                c.height = shc * 2;
                const ctx = c.getContext("2d");
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(
                  tileCanvas,
                  sx,
                  sy,
                  swc,
                  shc,
                  0,
                  0,
                  swc * 2,
                  shc * 2
                );
                const cropUrl = c.toDataURL("image/png");
                const res = await window.Tesseract.recognize(cropUrl, "eng", {
                  ...ocrOptsBase,
                  tessedit_char_whitelist:
                    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-",
                  tessedit_pageseg_mode: "7",
                });
                const raw = (res?.data?.text || "")
                  .toUpperCase()
                  .replace(/[^A-Z0-9-]/g, "")
                  .trim();
                if (!raw) continue;
                const norm = raw
                  .replace(/O/g, "0")
                  .replace(/B/g, "8")
                  .replace(/[IL]/g, "1");
                const roomRe =
                  /^(?:[A-Z]?\d{2,4}[A-Z]?|\d{1,2}[A-Z]-?\d{2,4}|\d{3,4}[A-Z]-?\d{1,2})$/;
                if (!roomRe.test(norm)) continue;
                const cxScaled = sx + swc / 2;
                const cyScaled = sy + shc / 2;
                const cxUnscaled = cxScaled / scale;
                const cyUnscaled = cyScaled / scale;
                const ux = (sx0 + cxUnscaled) / w;
                const uy = (sy0 + cyUnscaled) / h;
                if (ux > 0 && uy > 0 && ux < 1 && uy < 1) {
                  all.push({
                    id: uid(),
                    kind: "room",
                    roomNumber: norm,
                    name: "",
                    x: ux,
                    y: uy,
                  });
                }
              }
            }
          }
          if (!usedDetector) {
            setBusy(`Super Deep OCR: tile ${tileIndex}/${totalTiles}`);
            const urlA = await makeTileUrl(sx0, sy0, sw, sh, false);
            const resA = await window.Tesseract.recognize(
              urlA,
              "eng",
              ocrOptsBase
            );
            all.push(...processWords(resA?.data?.words || [], tile));

            if (cancelScanRef.current) throw new Error("Canceled");
            tileIndex += 1;
            setBusy(`Super Deep OCR: tile ${tileIndex}/${totalTiles}`);
            const urlB = await makeTileUrl(sx0, sy0, sw, sh, true);
            const resB = await window.Tesseract.recognize(
              urlB,
              "eng",
              ocrOptsBase
            );
            all.push(...processWords(resB?.data?.words || [], tile));
          }
        }
      }

      const byLabel = dedupByLabel(all, 0.004);
      const filtered = filterOutExistingSameLabel(byLabel);
      setPoints((prev) => [...prev, ...filtered]);
      setBusy(`Super Deep OCR: added ${filtered.length}`);
      setProgress(100, "Super Deep complete");
      setTimeout(() => setBusy(""), 2500);
    } catch (err) {
      if (err?.message === "Canceled") {
        setBusy("");
        return;
      }
      console.error(err);
      setBusy(`Super Deep OCR failed: ${err?.message || "Unknown error"}`);
      setTimeout(() => setBusy(""), 2500);
    }
    setTimeout(() => {
      setProgActive(false);
      setProgress(0, "");
    }, 600);
  };

  // Light detector using OpenCV.js: propose text boxes then OCR each
  const lightDetectRooms = async () => {
    if (!imageSrc || !natSize.w || !natSize.h) return;
    if (busy) return;
    setBusy("Loading OpenCV…");
    try {
      // Load OpenCV from same‑origin static file under public/opencv/
      if (!(window.cv && window.cv.Mat)) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "/opencv/opencv.js";
          s.async = true;
          s.onload = () => {
            if (window.cv && window.cv.Mat) resolve();
            else if (window.cv && window.cv["onRuntimeInitialized"]) {
              window.cv["onRuntimeInitialized"] = resolve;
            } else setTimeout(resolve, 150);
          };
          s.onerror = () =>
            reject(
              new Error(
                "OpenCV local script load failed (ensure frontend/public/opencv/opencv.js and opencv_js.wasm exist)"
              )
            );
          document.body.appendChild(s);
        });
      }
      const cv = window.cv;
      if (!cv || !cv.Mat) throw new Error("OpenCV not ready");
      setBusy("Light detect: proposing regions…");
      // Draw image to canvas at 2.5x for better small text
      const scale = 2.5;
      const dw = Math.floor(natSize.w * scale);
      const dh = Math.floor(natSize.h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext("2d");
      const img = new Image();
      img.crossOrigin = "anonymous";
      const srcUrl = imageSrc;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = srcUrl;
      });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, dw, dh);

      const src = cv.imread(canvas);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      const blur = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      const bin = new cv.Mat();
      cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(
        bin,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE
      );

      const boxes = [];
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const rect = cv.boundingRect(cnt);
        const { x, y, width, height } = rect;
        const area = width * height;
        if (area < 40 || area > (dw * dh) / 15) continue; // size filter
        const ar = width / (height || 1);
        if (ar < 0.8 || ar > 8) continue; // text-ish
        boxes.push({ x, y, w: width, h: height });
        cnt.delete();
      }
      contours.delete();
      hierarchy.delete();
      kernel.delete();
      blur.delete();
      gray.delete();
      bin.delete();
      src.delete();

      setBusy(`Light detect: OCR ${boxes.length} regions…`);
      const nw = natSize.w,
        nh = natSize.h;
      const ocrOpts = {
        workerPath:
          "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/worker.min.js",
        corePath:
          "https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js",
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-",
        psm: 7,
      };

      const results = [];
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const pad = 2;
        const rx = Math.max(0, b.x - pad),
          ry = Math.max(0, b.y - pad);
        const rw = Math.min(dw - rx, b.w + pad * 2),
          rh = Math.min(dh - ry, b.h + pad * 2);
        // Crop region to dataURL
        const c2 = document.createElement("canvas");
        c2.width = rw;
        c2.height = rh;
        const c2x = c2.getContext("2d");
        c2x.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
        const dataA = c2.toDataURL("image/png");
        const text = await ocrImage(dataA);
        const word = (text || "")
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, "")
          .trim();
        if (!word || word.length < 3) continue;
        const roomRe =
          /^(?:[A-Z]?\d{2,4}[A-Z]?|\d{1,2}[A-Z]-?\d{2,4}|\d{3,4}[A-Z]-?\d{1,2})$/;
        if (!roomRe.test(word)) continue;
        // Center in natural coords
        const cx = (rx + rw / 2) / scale / nw;
        const cy = (ry + rh / 2) / scale / nh;
        if (cx <= 0 || cy <= 0 || cx >= 1 || cy >= 1) continue;
        results.push({
          id: uid(),
          kind: "room",
          roomNumber: word,
          name: "",
          x: cx,
          y: cy,
        });
      }

      const kept = filterOutExistingSameLabel(dedupByLabel(results, 0.006));
      setPoints((prev) => [...prev, ...kept]);
      setBusy(`Light detect: added ${kept.length}`);
      setTimeout(() => setBusy(""), 2500);
    } catch (err) {
      console.error(err);
      setBusy(`Light detect failed: ${err?.message || "unknown"}`);
      setTimeout(() => setBusy(""), 2500);
    }
  };

  if (!imageSrc) {
    return (
      <div className="text-white">
        Upload a map image above to start placing points.
      </div>
    );
  }

  const toNorm = (clientX, clientY) => {
    const el = spacerRef.current; // use scaled box for pointer math
    const rect = el?.getBoundingClientRect();
    if (!rect || !el || !natSize.w || !natSize.h) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const ux = sx / zoom; // unscaled px
    const uy = sy / zoom;
    const x = clamp01(ux / natSize.w);
    const y = clamp01(uy / natSize.h);
    return { x, y };
  };

  const toPx = (x, y) => {
    if (!natSize.w || !natSize.h) return { x: 0, y: 0 };
    // return UN-SCALED px for content layer
    return { x: x * natSize.w, y: y * natSize.h };
  };

  const startAddAt = (clientX, clientY) => {
    const { x, y } = toNorm(clientX, clientY);
    const { x: baseUx, y: baseUy } = toPx(x, y); // unscaled px in content space
    const rect = spacerRef.current?.getBoundingClientRect();
    const POPUP_W = 320;
    const POPUP_H = 240;
    let xPx = baseUx * zoom + 8;
    let yPx = baseUy * zoom + 8;
    if (rect) {
      xPx = Math.min(Math.max(8, xPx), Math.max(8, rect.width - POPUP_W - 8));
      yPx = Math.min(Math.max(8, yPx), Math.max(8, rect.height - POPUP_H - 8));
    }
    const draft = { id: uid(), kind: "room", name: "", roomNumber: "", x, y };
    setEditing({ id: null, xPx, yPx, draft });
  };

  const onImageClick = (e) => {
    // When selection tools are active, disable click-to-add
    if (selectMode !== "none") return;
    // Avoid triggering when clicking on marker/form
    if (e.target.closest("[data-marker]")) return;
    if (e.target.closest("[data-editor]")) return;
    startAddAt(e.clientX, e.clientY);
  };

  const onMarkerMouseDown = (e, id) => {
    e.stopPropagation();
    if (selectMode !== "none") return; // disable dragging while selection tool is active
    setDrag({ id });
    setSelectedId(id);
  };

  const beginEdit = (p) => {
    if (selectMode !== "none") return; // disable editing while selection tool is active
    const { x, y } = p;
    const { x: baseUx, y: baseUy } = toPx(x, y);
    const rect = spacerRef.current?.getBoundingClientRect();
    const POPUP_W = 320;
    const POPUP_H = 240;
    let xPx = baseUx * zoom + 8;
    let yPx = baseUy * zoom + 8;
    if (rect) {
      xPx = Math.min(Math.max(8, xPx), Math.max(8, rect.width - POPUP_W - 8));
      yPx = Math.min(Math.max(8, yPx), Math.max(8, rect.height - POPUP_H - 8));
    }
    setEditing({ id: p.id, xPx, yPx, draft: { ...p } });
  };

  const saveDraft = () => {
    if (!editing) return;
    const d = editing.draft;
    // Require at least one of name or roomNumber
    if (!d.name && !d.roomNumber) return;
    setPoints((prev) => {
      const idx = prev.findIndex((p) => p.id === editing.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...d };
        return next;
      }
      return [...prev, { ...d }];
    });
    setSelectedId(d.id);
    setEditing(null);
  };

  const deletePoint = (id) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
    setEditing(null);
  };

  const exportJson = () => {
    // Export both points and current DB boxes so a session can resume exactly
    const data = { imageSrc, points, dbBoxes };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "map-points.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const onImport = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      if (Array.isArray(data?.points)) setPoints(data.points);
      if (Array.isArray(data?.dbBoxes)) setDbBoxes(data.dbBoxes);
    } catch {}
  };

  // OCR helpers for DB boxes: try multiple preprocessing/PSM variants
  const normalizeRoom = (raw) => {
    if (!raw) return "";
    let t = raw
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .trim();
    // common confusions
    t = t.replace(/O/g, "0").replace(/B/g, "8").replace(/[IL]/g, "1");
    return t;
  };
  // Tighten room pattern to avoid short false positives like "11" from letters
  // Rules:
  // - Pure numeric requires 3-4 digits (e.g., 802, 1411)
  // - Optional single letter prefix/suffix allowed with 2-4 digits (e.g., B02, 824S)
  // - Hyphenated forms allowed (e.g., 2B-104, 913A-1)
  const roomRegex =
    /^(?:[A-Z]?\d{3,4}[A-Z]?|\d{1,2}[A-Z]-?\d{2,4}|\d{3,4}[A-Z]-?\d{1,2})$/;
  const isRoomLike = (t) => {
    if (!t) return false;
    if (!roomRegex.test(t)) return false;
    const digits = (t.match(/\d/g) || []).length;
    const letters = (t.match(/[A-Z]/g) || []).length;
    // Require at least 2 digits overall; if no letters, require >=3 digits
    if (digits < 2) return false;
    if (letters === 0 && digits < 3) return false;
    return true;
  };
  const enhanceCanvas = (srcCanvas, { invert = false, boost = true } = {}) => {
    const w = srcCanvas.width,
      h = srcCanvas.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    // grayscale + simple contrast stretch
    let min = 255,
      max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    const a = max > min ? 255 / (max - min) : 1;
    const b = -min * a;
    for (let i = 0; i < d.length; i += 4) {
      let y = d[i] * a + b;
      if (boost) y = Math.min(255, Math.max(0, (y - 128) * 1.25 + 128));
      if (invert) y = 255 - y;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  };
  // Per-box OCR refinement
  // Given a cropped canvas from a DB box, try multiple preprocess variants:
  //  - normal/inverted grayscale + contrast stretch
  //  - multiple PSMs (7 single line, 6 assume a uniform block, 13 raw line)
  //  - 2x/3x scale
  // We then pick the highest-confidence token that matches the room regex.
  const recognizeRoomFromCanvas = async (baseCanvas, ocrOptsBase) => {
    const variants = [
      { invert: false, psm: "7", scale: 2 },
      { invert: true, psm: "7", scale: 2 },
      { invert: false, psm: "7", scale: 3 },
      { invert: true, psm: "6", scale: 3 },
      { invert: false, psm: "13", scale: 3 },
    ];
    for (const v of variants) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(baseCanvas.width * v.scale));
      c.height = Math.max(1, Math.round(baseCanvas.height * v.scale));
      const ct = c.getContext("2d");
      ct.imageSmoothingEnabled = true;
      ct.imageSmoothingQuality = "high";
      ct.drawImage(baseCanvas, 0, 0, c.width, c.height);
      const e = enhanceCanvas(c, { invert: v.invert, boost: true });
      const url = e.toDataURL("image/png");
      const res = await window.Tesseract.recognize(url, "eng", {
        ...ocrOptsBase,
        tessedit_pageseg_mode: v.psm,
      });
      // Prefer the most confident room-like token
      let best = "";
      let bestConf = -1;
      const words = Array.isArray(res?.data?.words) ? res.data.words : [];
      for (const w of words) {
        const n = normalizeRoom(w?.text || "");
        const conf =
          typeof w?.confidence === "number"
            ? w.confidence
            : typeof w?.conf === "number"
            ? w.conf
            : 0;
        if (isRoomLike(n) && conf >= 65 && conf > bestConf) {
          best = n;
          bestConf = conf;
        }
      }
      if (best) return best;
      // Fallback: whole text block
      const norm = normalizeRoom(res?.data?.text || "");
      if (isRoomLike(norm)) return norm;
    }
    return "";
  };

  const focusPoint = (p) => {
    try {
      const targetX = p.x * natSize.w * zoom;
      const targetY = p.y * natSize.h * zoom;
      const sc = scrollRef.current;
      if (sc) {
        const left = Math.max(0, targetX - sc.clientWidth / 2);
        const top = Math.max(0, targetY - sc.clientHeight / 2);
        sc.scrollTo({ left, top, behavior: "smooth" });
      }
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPulseId(p.id);
      setTimeout(() => setPulseId(null), 3000);
      setSelectedId(p.id);
    } catch {}
  };

  return (
    <div className="card shadow-sm bg-card">
      <div className="card-body">
        <div
          className="d-flex align-items-center justify-content-between mb-2"
          ref={rootRef}
        >
          <div className="d-flex align-items-center">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => changeZoom(-0.1)}
            >
              -
            </button>
            <input
              className="form-range mx-2"
              type="range"
              min="0.25"
              max="4"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              style={{ width: "120px" }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => changeZoom(+0.1)}
            >
              +
            </button>
          </div>

          <div className="flex-grow-1 text-center">
            <h5 className="card-title text-white fw-bold h2 text-white fw-bold mb-0">
              Map Editor
            </h5>
          </div>

          <div>
            <select
              className="form-select form-select-sm bg-card-inner text-black"
              value={detectorMode}
              onChange={(e) => setDetectorMode(e.target.value)}
            >
              <option value="none">Detector: None</option>
              <option value="db">Detector: DB (beta)</option>
            </select>

            {detectorMode === "db" && (
              <div
                className="d-flex align-items-center ms-2 small text-muted"
                style={{ gap: 10 }}
              >
                <span>Thresh</span>
                <input
                  type="range"
                  min="0.001"
                  max="0.5"
                  step="0.001"
                  value={dbThresh}
                  onChange={(e) => setDbThresh(parseFloat(e.target.value))}
                  style={{ width: 120 }}
                />
                <span>{dbThresh.toFixed(3)}</span>
                <span>Norm</span>
                <select
                  className="form-select form-select-sm"
                  value={dbNorm}
                  onChange={(e) => setDbNorm(e.target.value)}
                >
                  <option value="imagenet">imagenet</option>
                  <option value="raw">raw</option>
                </select>
                <span>Chan</span>
                <select
                  className="form-select form-select-sm"
                  value={dbBgr ? "bgr" : "rgb"}
                  onChange={(e) => setDbBgr(e.target.value === "bgr")}
                >
                  <option value="rgb">RGB</option>
                  <option value="bgr">BGR</option>
                </select>
                <span>Stride</span>
                <select
                  className="form-select form-select-sm"
                  value={dbStride}
                  onChange={(e) => setDbStride(parseInt(e.target.value))}
                >
                  <option value="32">32</option>
                  <option value="16">16</option>
                </select>

                <button
                  className={`btn btn-sm ${
                    selectMode === "db" ? "btn-danger" : "btn-outline-danger"
                  }`}
                  title="Draw to delete DB boxes"
                  onClick={() =>
                    setSelectMode((m) => (m === "db" ? "none" : "db"))
                  }
                >
                  Select DB boxes
                </button>
                <button
                  className={`btn btn-sm ${
                    selectMode === "points"
                      ? "btn-danger"
                      : "btn-outline-danger"
                  }`}
                  title="Draw to delete pins"
                  onClick={() =>
                    setSelectMode((m) => (m === "points" ? "none" : "points"))
                  }
                >
                  Select pins
                </button>
              </div>
            )}
          </div>
        </div>
        {progActive && (
          <div className="mb-2">
            <div className="d-flex justify-content-between small text-muted">
              <span>{progLabel || "Scanning…"}</span>
              <span>{progPct}%</span>
            </div>
            <div className="progress" style={{ height: 6 }}>
              <div
                className="progress-bar"
                role="progressbar"
                style={{ width: `${progPct}%` }}
                aria-valuenow={progPct}
                aria-valuemin="0"
                aria-valuemax="100"
              ></div>
            </div>
          </div>
        )}
        <div
          className="position-relative"
          ref={scrollRef}
          style={{ overflow: "auto", maxHeight: 600, borderRadius: 10 }}
        >
          <div
            ref={spacerRef}
            className="position-relative"
            style={{
              width: (natSize.w || 0) * zoom,
              height: (natSize.h || 0) * zoom,
            }}
          >
            <div
              ref={contentRef}
              className="position-absolute justify-content-center align-items-center"
              style={{
                width: natSize.w || 0,
                height: natSize.h || 0,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                cursor: selectMode === "none" ? "default" : "crosshair",
              }}
              onClick={onImageClick}
              onMouseDown={(e) => {
                if (selectMode === "none") return;
                if (e.button !== 0) return; // left only
                if (
                  e.target.closest("[data-marker]") ||
                  e.target.closest("[data-editor]")
                )
                  return;
                const { x, y } = toNorm(e.clientX, e.clientY);
                setSelectRect({ x0: x, y0: y, x1: x, y1: y });
                const move = (ev) => {
                  const p = toNorm(ev.clientX, ev.clientY);
                  setSelectRect((r) => (r ? { ...r, x1: p.x, y1: p.y } : null));
                };
                const up = () => {
                  window.removeEventListener("mousemove", move);
                  window.removeEventListener("mouseup", up);
                  setSelectRect((r) => {
                    if (!r) return null;
                    const x0 = Math.min(r.x0, r.x1);
                    const y0 = Math.min(r.y0, r.y1);
                    const x1 = Math.max(r.x0, r.x1);
                    const y1 = Math.max(r.y0, r.y1);
                    if (selectMode === "db") {
                      setDbBoxes((prev) => {
                        const before = prev.length;
                        const next = prev.filter((b) => {
                          const bx0 = b.xN,
                            by0 = b.yN;
                          const bx1 = b.xN + b.wN;
                          const by1 = b.yN + b.hN;
                          const overlap = !(
                            bx1 < x0 ||
                            bx0 > x1 ||
                            by1 < y0 ||
                            by0 > y1
                          );
                          return !overlap;
                        });
                        const removed = before - next.length;
                        if (removed > 0) {
                          setBusy(`Removed ${removed} DB boxes`);
                          setTimeout(() => setBusy(""), 1200);
                        }
                        return next;
                      });
                    } else if (selectMode === "points") {
                      setPoints((prev) => {
                        const before = prev.length;
                        const next = prev.filter(
                          (p) =>
                            !(p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
                        );
                        const removed = before - next.length;
                        if (removed > 0) {
                          setBusy(`Removed ${removed} pins`);
                          setTimeout(() => setBusy(""), 1200);
                        }
                        return next;
                      });
                    }
                    return null;
                  });
                };
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
              }}
            >
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Map"
                onLoad={onImgLoad}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
                draggable={false}
              />

              {/* heatmap disabled */}
              {selectRect &&
                (() => {
                  const x0 = Math.min(selectRect.x0, selectRect.x1);
                  const y0 = Math.min(selectRect.y0, selectRect.y1);
                  const x1 = Math.max(selectRect.x0, selectRect.x1);
                  const y1 = Math.max(selectRect.y0, selectRect.y1);
                  const { x: lx, y: ty } = toPx(x0, y0);
                  const { x: rx, y: by } = toPx(x1, y1);
                  const w = Math.max(1, rx - lx);
                  const h = Math.max(1, by - ty);
                  return (
                    <div
                      className="position-absolute"
                      style={{
                        left: lx,
                        top: ty,
                        width: w,
                        height: h,
                        background: "rgba(200,80,80,0.15)",
                        border: "2px solid rgba(200,80,80,0.8)",
                        pointerEvents: "none",
                      }}
                    />
                  );
                })()}
              {/* DB boxes overlay */}
              {dbBoxes &&
                dbBoxes.length > 0 &&
                dbBoxes.map((b, idx) => {
                  const x = b.xN * (natSize.w || 0);
                  const y = b.yN * (natSize.h || 0);
                  const wbox = b.wN * (natSize.w || 0);
                  const hbox = b.hN * (natSize.h || 0);
                  return (
                    <div
                      key={`db-${idx}`}
                      className="position-absolute"
                      style={{
                        left: x,
                        top: y,
                        width: wbox,
                        height: hbox,
                        border: "2px dashed rgba(199,108,47,0.9)",
                        backgroundColor: "rgba(199,108,47,0.03)",
                        zIndex: 2,
                      }}
                      title={`DB box ${idx + 1}`}
                    />
                  );
                })}
              {/* peaks overlay removed */}

              {points.map((p) => {
                const pos = toPx(p.x, p.y);
                const isSel = selectedId === p.id;
                const size = 8;
                return (
                  <div
                    key={p.id}
                    data-marker
                    onMouseDown={(e) => onMarkerMouseDown(e, p.id)}
                    onDoubleClick={() => beginEdit(p)}
                    className={`position-absolute rounded-circle marker ${markerClass(
                      p.kind
                    )} ${isSel ? "border border-light" : ""} ${
                      pulseId === p.id ? "marker--pulse" : ""
                    }`}
                    style={{
                      left: pos.x - size / 2,
                      top: pos.y - size / 2,
                      width: size,
                      height: size,
                      cursor: selectMode === "none" ? "grab" : "crosshair",
                      transformOrigin: "center",
                      pointerEvents: selectMode === "none" ? "auto" : "none",
                    }}
                    title={
                      (p.roomNumber ? `#${p.roomNumber} ` : "") +
                      (p.name || p.poiType || p.kind)
                    }
                  />
                );
              })}
            </div>
            {editing && (
              <div
                data-editor
                className="position-absolute card shadow"
                style={{
                  left: editing.xPx,
                  top: editing.yPx,
                  minWidth: 320,
                  maxWidth: 360,
                  zIndex: 5,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="card-body">
                  <div className="mb-2">
                    <label className="form-label">Kind</label>
                    <select
                      className="form-select form-select-sm"
                      value={editing.draft.kind}
                      onChange={(e) =>
                        setEditing((s) => ({
                          ...s,
                          draft: { ...s.draft, kind: e.target.value },
                        }))
                      }
                    >
                      <option value="room">Room</option>
                      <option value="door">Door</option>
                      <option value="poi">POI</option>
                    </select>
                  </div>

                  {editing.draft.kind === "poi" && (
                    <div className="mb-2">
                      <label className="form-label">POI Type</label>
                      <select
                        className="form-select form-select-sm"
                        value={editing.draft.poiType || POI_TYPES[0]}
                        onChange={(e) =>
                          setEditing((s) => ({
                            ...s,
                            draft: { ...s.draft, poiType: e.target.value },
                          }))
                        }
                      >
                        {POI_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mb-2">
                    <label className="form-label">Name</label>
                    <input
                      className="form-control form-control-sm"
                      type="text"
                      value={editing.draft.name || ""}
                      onChange={(e) =>
                        setEditing((s) => ({
                          ...s,
                          draft: { ...s.draft, name: e.target.value },
                        }))
                      }
                      placeholder="e.g., Physics Lab"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="form-label">Room Number</label>
                    <input
                      className="form-control form-control-sm"
                      type="text"
                      value={editing.draft.roomNumber || ""}
                      onChange={(e) =>
                        setEditing((s) => ({
                          ...s,
                          draft: { ...s.draft, roomNumber: e.target.value },
                        }))
                      }
                      placeholder="e.g., 2B-104"
                    />
                  </div>

                  <div className="d-flex gap-2 justify-content-end">
                    {editing.id && (
                      <button
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => deletePoint(editing.id)}
                      >
                        Delete
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={
                        !editing.draft.name && !editing.draft.roomNumber
                      }
                      onClick={saveDraft}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex gap-2 mt-3 align-items-center flex-wrap">
          <button className="btn btn-outline-warning" onClick={exportJson}>
            Export JSON
          </button>
          <label className="btn btn-warning text-white mb-0">
            Import JSON
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={onImport}
            />
          </label>

          <button
            className="btn btn-info text-white"
            onClick={async () => {
              if (detectorMode !== "db") {
                setBusy("Switch detector to DB");
                setTimeout(() => setBusy(""), 1500);
                return;
              }
              setBusy("DB detect…");
              setProgActive(true);
              setProgress(0, "DB detect");
              const ok = await ensureDbnet();
              if (!ok) {
                setBusy("DB model missing at /models/dbnet.onnx");
                setProgActive(false);
                setTimeout(() => setBusy(""), 2000);
                return;
              }
              const boxesA = await detectDbnet(imageSrc, {
                maxSide: 1536,
                probThresh: dbThresh,
                stride: dbStride,
                bgr: dbBgr,
                norm: dbNorm,
                applySigmoid: dbSigmoid,
                forceChannel: dbForceCh === "auto" ? null : parseInt(dbForceCh),
                useSoftmax: dbSoftmax,
                debug: true,
              });
              // Invert image via canvas
              const inv = document.createElement("canvas");
              const i = new Image();
              i.crossOrigin = "anonymous";
              await new Promise((r, j) => {
                i.onload = r;
                i.onerror = () => j(new Error("img"));
                i.src = imageSrc;
              });
              inv.width = i.naturalWidth || i.width;
              inv.height = i.naturalHeight || i.height;
              const ict = inv.getContext("2d");
              ict.drawImage(i, 0, 0);
              const id = ict.getImageData(0, 0, inv.width, inv.height);
              const d = id.data;
              for (let k = 0; k < d.length; k += 4) {
                d[k] = 255 - d[k];
                d[k + 1] = 255 - d[k + 1];
                d[k + 2] = 255 - d[k + 2];
              }
              ict.putImageData(id, 0, 0);
              const boxesB = await detectDbnet(inv.toDataURL("image/png"), {
                maxSide: 1536,
                probThresh: dbThresh,
                stride: dbStride,
                bgr: dbBgr,
                norm: dbNorm,
                applySigmoid: dbSigmoid,
                forceChannel: dbForceCh === "auto" ? null : parseInt(dbForceCh),
                useSoftmax: dbSoftmax,
                debug: true,
              });
              const merged = [...(boxesA || []), ...(boxesB || [])];
              setDbBoxes(merged);
              /* heatmap removed */
              setBusy(`DB detect: ${merged.length} boxes`);
              setProgress(100, "DB detect");
              setTimeout(() => {
                setBusy("");
                setProgActive(false);
                setProgress(0, "");
              }, 1200);
            }}
            disabled={!!busy}
          >
            Detect (DB only)
          </button>
          <button
            className="btn btn-success"
            onClick={async () => {
              if (!dbBoxes || dbBoxes.length === 0) {
                setBusy("No DB boxes");
                setTimeout(() => setBusy(""), 1500);
                return;
              }
              setBusy("OCR DB boxes…");
              setProgActive(true);
              setProgress(0, "OCR DB");
              if (!window.Tesseract) {
                await new Promise((resolve, reject) => {
                  const s = document.createElement("script");
                  s.src =
                    "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/tesseract.min.js";
                  s.onload = resolve;
                  s.onerror = () => reject(new Error("tess"));
                  document.body.appendChild(s);
                });
              }
              const ocrOpts = {
                workerPath:
                  "https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/worker.min.js",
                corePath:
                  "https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js",
                langPath: "https://tessdata.projectnaptha.com/4.0.0",
                tessedit_char_whitelist:
                  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-",
              };
              // prepare canvas of full image
              const base = document.createElement("canvas");
              const img = new Image();
              img.crossOrigin = "anonymous";
              await new Promise((r, j) => {
                img.onload = r;
                img.onerror = () => j(new Error("img"));
                img.src = imageSrc;
              });
              base.width = img.naturalWidth || img.width;
              base.height = img.naturalHeight || img.height;
              base.getContext("2d").drawImage(img, 0, 0);
              let done = 0;
              const total = dbBoxes.length;
              const added = [];
              for (const b of dbBoxes) {
                done += 1;
                setProgress(
                  Math.round((done * 100) / total),
                  `OCR DB: ${done}/${total}`
                );
                const sx = Math.max(0, Math.round(b.xN * base.width) - 4);
                const sy = Math.max(0, Math.round(b.yN * base.height) - 4);
                const sw = Math.max(1, Math.round(b.wN * base.width) + 8);
                const sh = Math.max(1, Math.round(b.hN * base.height) + 8);
                const crop = document.createElement("canvas");
                crop.width = sw;
                crop.height = sh;
                crop
                  .getContext("2d")
                  .drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);
                const norm = await recognizeRoomFromCanvas(crop, ocrOpts);
                if (!norm) continue;
                const ux = (sx + sw / 2) / base.width;
                const uy = (sy + sh / 2) / base.height;
                added.push({
                  id: uid(),
                  kind: "room",
                  roomNumber: norm,
                  name: "",
                  x: ux,
                  y: uy,
                });
              }
              const filtered = filterOutExistingSameLabel(
                dedupByLabel(added, 0.006)
              );
              setPoints((prev) => [...prev, ...filtered]);
              setBusy(`OCR DB: added ${filtered.length}`);
              setProgress(100, "OCR DB");
              setTimeout(() => {
                setBusy("");
                setProgActive(false);
                setProgress(0, "");
              }, 1200);
            }}
            disabled={!!busy}
          >
            OCR DB boxes
          </button>

          <div className="d-flex align-items-center ms-5">
            <input
              className="form-range text-white"
              type="range"
              min="0.002"
              max="0.02"
              step="0.001"
              value={dupRadius}
              onChange={(e) => setDupRadius(parseFloat(e.target.value))}
              style={{ width: 120 }}
            />
            <span className="ms-1 text-white">{dupRadius.toFixed(3)}</span>
          </div>
          {busy && (
            <span className="ms-2 text-white" aria-live="polite">
              {busy}
            </span>
          )}

          <button
            className="btn btn-outline-danger ms-5"
            onClick={() => {
              setDbBoxes([]); /* heatmap removed */
            }}
            disabled={!!busy}
          >
            Clear DB boxes
          </button>

          <button className="btn btn-danger" onClick={() => setPoints([])}>
            Clear Points
          </button>
        </div>
        {points.length > 0 && (
          <div className="mt-3">
            <h6 className="text-dark">Points ({points.length})</h6>
            <ul className="list-group">
              {points
                .slice()
                .sort((a, b) => {
                  const ka = (
                    a.roomNumber ||
                    a.name ||
                    a.poiType ||
                    a.kind ||
                    ""
                  ).toString();
                  const kb = (
                    b.roomNumber ||
                    b.name ||
                    b.poiType ||
                    b.kind ||
                    ""
                  ).toString();
                  return collator.compare(ka, kb);
                })
                .map((p) => (
                  <li
                    key={p.id}
                    className={`list-group-item d-flex justify-content-between align-items-center ${
                      selectedId === p.id ? "active" : ""
                    }`}
                    onClick={() => focusPoint(p)}
                    onDoubleClick={() => beginEdit(p)}
                    style={{ cursor: "pointer" }}
                  >
                    <span>
                      <span className={`badge me-2 ${markerClass(p.kind)}`}>
                        {" "}
                      </span>
                      {p.roomNumber
                        ? `#${p.roomNumber}`
                        : p.name || p.poiType || p.kind}
                    </span>
                    <small className="text-muted">
                      ({p.kind}
                      {p.poiType ? `:${p.poiType}` : ""})
                    </small>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
