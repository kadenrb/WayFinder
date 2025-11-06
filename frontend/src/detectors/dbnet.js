/*
  DB DETECTOR — concise overview

  What is this?
  - A tiny wrapper to run a DB (Differentiable Binarization) text detector model in the browser.
  - It uses onnxruntime-web to run the model, and OpenCV (WASM) to turn a "probability picture" into boxes.

  How it works
  1) We resize the image nicely (letterbox): we keep aspect ratio and pad to a size the model likes.
  2) The model outputs a grid where each cell says "how texty" that spot is.
  3) We turn that grid into a mask (true/false), then find blobs (contours or a simple connected-components fallback).
  4) Each blob becomes a box. We then map boxes back to the original image size.

  Why letterbox
  - Letterbox lets us keep the whole image and step size together, so mapping back to original pixels is easy and accurate.

  Key helpers
  - ensureDbnet(): load ORT + model, ready to run.
  - detectDbnetProbs(): give me the probability map.
  - detectDbnet(): give me ready-to-use boxes.

  Safety nets
  - If OpenCV isn’t ready, we still make boxes using a simple JS flood-fill (CCL).
  - If the model outputs more than 1 channel, we pick the best one (softmax + heuristics), or a forced channel if chosen.
*/

let ort = null;
let session = null;
let cvReady = false;

async function ensureCvLocal() {
  if (cvReady) return true;
  try {
    if (!(window.cv && window.cv.Mat)) {
      await new Promise((resolve, reject) => {
        // Ensure Emscripten locates opencv_js.wasm next to opencv.js
        // This must be set before the script tag executes
        try {
          window.Module = window.Module || {};
          // Only override locateFile if not already provided
          if (!window.Module.locateFile) {
            window.Module.locateFile = (f) => `/opencv/${f}`;
          }
        } catch {}

        const s = document.createElement('script');
        s.src = '/opencv/opencv.js';
        s.async = true;
        s.onerror = () => reject(new Error('OpenCV not found at /opencv/opencv.js'));
        s.onload = () => {
          // If runtime not yet initialized, hook into it
          if (window.cv && window.cv.Mat) {
            resolve();
          } else if (window.cv && typeof window.cv.onRuntimeInitialized === 'function') {
            const prev = window.cv.onRuntimeInitialized;
            window.cv.onRuntimeInitialized = () => { try { prev(); } catch {} resolve(); };
          } else if (window.cv && 'onRuntimeInitialized' in window.cv) {
            window.cv.onRuntimeInitialized = resolve;
          } else {
            // Fallback: wait a tick
            setTimeout(resolve, 200);
          }
        };
        document.body.appendChild(s);
      });
    }
    cvReady = !!(window.cv && window.cv.Mat);
  } catch (e) {
    cvReady = false;
  }
  return cvReady;
}

export async function ensureDbnet(modelPath = '/models/dbnet.onnx') {
  if (!ort) {
    try {
      const mod = await import('onnxruntime-web');
      ort = mod && (mod.default || mod);
      // Ensure ORT fetches its WASM binaries from a CDN with correct MIME
      // This avoids CRA serving HTML for '/ort-wasm.wasm'
      if (ort && ort.env && ort.env.wasm) {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
        // Optional: keep threads small for compatibility
        try { ort.env.wasm.numThreads = 1; } catch {}
      }
    } catch (e) {
      return false;
    }
  }
  if (!session) {
    try {
      session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    } catch (e) {
      // model missing or failed to load
      session = null;
      return false;
    }
  }
  return true;
}

// Helper: extract a probability map from an ORT output tensor. Handles
//  - 1-channel logits/probabilities
//  - 2+ channel logits where softmax along channel is expected
// Normalize various output layouts to a single HxW probability grid
function extractProbMapFromOutput(out, { applySigmoid = true, forceChannel = null, useSoftmax = true } = {}) {
  // This function digests whatever output shape the model gives us and returns
  // a simple 2D probability grid (oh x ow). If the model has multiple channels
  // (like background vs text), we softmax and choose the "textiest" channel.
  const dims = out.dims || [];
  // Default height/width
  let oh = 1, ow = 1, ch = 1, layout = 'HW';
  if (dims.length === 4) {
    // Prefer NCHW if C seems reasonable
    if (dims[1] > 1 && dims[1] <= 64) { ch = dims[1]; oh = dims[2]; ow = dims[3]; layout = 'NCHW'; }
    else if (dims[3] > 1 && dims[3] <= 64) { ch = dims[3]; oh = dims[1]; ow = dims[2]; layout = 'NHWC'; }
    else {
      // fallback: single channel
      ch = 1; if (dims[1] === 1) { oh = dims[2]; ow = dims[3]; } else { oh = dims[dims.length-2]; ow = dims[dims.length-1]; }
      layout = 'HW';
    }
  } else {
    oh = dims[dims.length-2] || 1; ow = dims[dims.length-1] || 1; ch = 1; layout = 'HW';
  }

  const data = out.data;
  const probs = new Float32Array(oh * ow);
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  if (ch <= 1) {
    // Single-channel: apply sigmoid if requested
    if (applySigmoid) {
      for (let i = 0; i < oh * ow; i++) probs[i] = sigmoid(data[i]);
    } else {
      for (let i = 0; i < oh * ow; i++) probs[i] = data[i] || 0;
    }
    return { probs, oh, ow, ch: 1, channelUsed: 0, layout };
  }

  // Multi-channel: compute softmax along channel and pick text-like channel
  const C = ch;
  const tmp = new Float32Array(C);
  const stats = new Float64Array(C * 2); // [sum, sumsq] per channel
  const get = (c, y, x) => {
    if (layout === 'NCHW') return data[c * oh * ow + y * ow + x] || 0;
    else /* NHWC */ return data[(y * ow + x) * C + c] || 0;
  };
  let bestC = (typeof forceChannel === 'number' && forceChannel >=0 && forceChannel < C) ? forceChannel : null;
  if (bestC == null) {
    if (useSoftmax) {
      for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
          // softmax
          let maxLogit = -Infinity;
          for (let c = 0; c < C; c++) { const v = get(c, y, x); if (v > maxLogit) maxLogit = v; tmp[c] = v; }
          let sumExp = 0;
          for (let c = 0; c < C; c++) { const e = Math.exp(tmp[c] - maxLogit); tmp[c] = e; sumExp += e; }
          for (let c = 0; c < C; c++) {
            const p = tmp[c] / (sumExp || 1);
            stats[c*2 + 0] += p;
            stats[c*2 + 1] += p * p;
          }
        }
      }
      // Choose channel with highest std deviation (text tends to have spikes)
      let bestStd = -1; const total = oh * ow;
      for (let c = 0; c < C; c++) {
        const mean = stats[c*2 + 0] / total;
        const varc = (stats[c*2 + 1] / total) - (mean * mean);
        const std = varc > 0 ? Math.sqrt(varc) : 0;
        if (std > bestStd) { bestStd = std; bestC = c; }
      }
    } else {
      // Use variance of raw logits per channel
      let bestStd = -1; const sums = new Float64Array(C); const sums2 = new Float64Array(C);
      for (let y=0;y<oh;y++) for (let x=0;x<ow;x++) {
        for (let c=0;c<C;c++){ const v=get(c,y,x); sums[c]+=v; sums2[c]+=v*v; }
      }
      const total = oh*ow;
      for (let c=0;c<C;c++) { const mean=sums[c]/total; const varc=sums2[c]/total - mean*mean; const std=varc>0?Math.sqrt(varc):0; if(std>bestStd){bestStd=std; bestC=c;} }
    }
    if (bestC == null && C === 2) bestC = 1; // default
  }

  // Recompute probs for chosen channel
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let p;
      if (useSoftmax) {
        let maxLogit = -Infinity;
        for (let c = 0; c < C; c++) { const v = get(c, y, x); if (v > maxLogit) maxLogit = v; tmp[c] = v; }
        let sumExp = 0;
        for (let c = 0; c < C; c++) { const e = Math.exp(tmp[c] - maxLogit); tmp[c] = e; sumExp += e; }
        p = tmp[bestC] / (sumExp || 1);
      } else {
        // Use chosen channel raw logit -> optional sigmoid
        const v = get(bestC, y, x);
        p = applySigmoid ? (1 / (1 + Math.exp(-v))) : v;
      }
      probs[y * ow + x] = p;
    }
  }
  return { probs, oh, ow, ch: C, channelUsed: bestC, layout };
}


// Letterbox to stride with ImageNet normalization if requested
// Resize while keeping aspect ratio, pad to stride, and convert to float tensor
async function imageToTensorLetterbox(src, { maxSide = 1024, stride = 32, bgr = false, norm = 'imagenet' } = {}) {
  let img;
  if (typeof src === 'string') {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image load failed'));
      i.src = src;
    });
  } else {
    img = src;
  }
  const iw = img.width || img.videoWidth || img.naturalWidth;
  const ih = img.height || img.videoHeight || img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const newW = Math.round(iw * scale);
  const newH = Math.round(ih * scale);
  let tw = Math.max(stride, Math.round(newW / stride) * stride);
  let th = Math.max(stride, Math.round(newH / stride) * stride);
  const dx = Math.floor((tw - newW) / 2);
  const dy = Math.floor((th - newH) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,tw,th);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, iw, ih, dx, dy, newW, newH);
  const imgData = ctx.getImageData(0, 0, tw, th);
  const data = new Float32Array(1 * 3 * th * tw);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const idx = (y * tw + x) * 4;
      let r = imgData.data[idx] / 255;
      let g = imgData.data[idx + 1] / 255;
      let b = imgData.data[idx + 2] / 255;
      if (norm === 'imagenet') {
        r = (r - mean[0]) / std[0];
        g = (g - mean[1]) / std[1];
        b = (b - mean[2]) / std[2];
      }
      if (bgr) {
        data[0 * th * tw + y * tw + x] = b;
        data[1 * th * tw + y * tw + x] = g;
        data[2 * th * tw + y * tw + x] = r;
      } else {
        data[0 * th * tw + y * tw + x] = r;
        data[1 * th * tw + y * tw + x] = g;
        data[2 * th * tw + y * tw + x] = b;
      }
    }
  }
  return { tensor: new ort.Tensor('float32', data, [1, 3, th, tw]), tw, th, iw, ih, dx, dy, scale };
}

function nms(boxes, iouThresh = 0.3) {
  const res = [];
  const sorted = boxes.slice().sort((a, b) => b.score - a.score);
  const used = new Array(sorted.length).fill(false);
  function iou(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const ua = a.w * a.h + b.w * b.h - inter;
    return ua <= 0 ? 0 : inter / ua;
  }
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const a = sorted[i];
    res.push(a);
    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j]) continue;
      if (iou(a, sorted[j]) > iouThresh) used[j] = true;
    }
  }
  return res;
}

// Very rough DBNet post-process: threshold prob map, slide-window boxes, then NMS.
export async function detectDbnet(src, opts = {}) {
  // Turn the probability grid into boxes:
  // - threshold (use a smart relative rule if values are tiny)
  // - make a mask at the letterboxed size (tw x th)
  // - find blobs (OpenCV or JS fallback)
  // - un-letterbox back to original image coords and normalize 0..1
  if (!session) return [];
  const { maxSide = 1536, probThresh = 0.12, step = 6, boxSize = 28, stride = 32, bgr = false, norm = 'imagenet', applySigmoid = true } = opts;
  const { tensor, tw, th, iw, ih, dx, dy, scale } = await imageToTensorLetterbox(src, { maxSide, stride, bgr, norm });
  const feeds = {};
  const inputName = session.inputNames[0];
  feeds[inputName] = tensor;
  let bestOut = null;
  try {
    const results = await session.run(feeds);
    if (opts && opts.debug) {
      try {
        console.log('DB outputs:', Object.keys(results).map(k=>({name:k,dims:results[k]?.dims}))); 
        const firstName = Object.keys(results)[0];
        const sample = Array.from(results[firstName]?.data || []).slice(0,16);
        console.log('DB sample', firstName, sample);
      } catch {}
    }
    // pick the output with largest H*W area
    let bestArea = -1;
    for (const name of session.outputNames) {
      const o = results[name];
      if (!o || !o.dims || o.dims.length < 2) continue;
      const dims = o.dims;
      // try to infer H,W from dims
      let oh = 1, ow = 1;
      if (dims.length === 4) {
        if (dims[1] > 1 && dims[1] <= 64) { oh = dims[2]; ow = dims[3]; }
        else if (dims[3] > 1 && dims[3] <= 64) { oh = dims[1]; ow = dims[2]; }
        else if (dims[1] === 1) { oh = dims[2]; ow = dims[3]; }
        else { oh = dims[dims.length-2]; ow = dims[dims.length-1]; }
      } else {
        oh = dims[dims.length-2]; ow = dims[dims.length-1];
      }
      const area = (oh|0) * (ow|0);
      if (area > bestArea) { bestArea = area; bestOut = { tensor: o, oh, ow }; }
    }
  } catch (e) {
    return [];
  }
  if (!bestOut) return [];
  const { tensor: out } = bestOut;
  const { probs, oh, ow } = extractProbMapFromOutput(out, { applySigmoid, forceChannel: opts.forceChannel ?? null, useSoftmax: opts.useSoftmax ?? true });
  // Convert prob map to upsampled mask (tw x th), then use OpenCV to find contours
  // Try to load OpenCV; if unavailable, continue to JS fallback below
  let cv = null;
  try { const ok = await ensureCvLocal(); if (ok) cv = window.cv; } catch {}
  // Upsample probs to letterboxed size
  const mask = new Uint8ClampedArray(tw * th);
  const scaleW = tw / ow; const scaleH = th / oh;
  // Compute distribution stats and choose a threshold strategy
  let min=Infinity, max=-Infinity, sum=0; for(let i=0;i<probs.length;i++){ const v=probs[i]; if(v<min)min=v; if(v>max)max=v; sum+=v; }
  const mean = sum / Math.max(1, probs.length);
  let v2=0; for(let i=0;i<probs.length;i++){ const d=probs[i]-mean; v2+=d*d; }
  const std = Math.sqrt(v2 / Math.max(1, probs.length));
  let thr;
  if (max <= 0.05 || (mean < 0.02 && std < 0.02)) {
    // Values are tiny (already probabilities near 0). Use high quantile to pick peaks.
    const arr = Array.from(probs);
    arr.sort((a,b)=>a-b);
    const q = 0.995; // top 0.5%
    thr = arr[Math.max(0, Math.min(arr.length-1, Math.floor(arr.length*q)))];
    thr = Math.max(thr, 1e-4);
  } else {
    // If the map is centered near 0.5, mean+std isolates hotter regions
    const rel = mean + 1.0*std;
    // Use UI threshold only if it's lower than rel; otherwise rel
    thr = Math.max(0.01, Math.min(0.95, Math.max(probThresh, rel)));
  }
  for (let y = 0; y < th; y++) {
    const oy = Math.min(oh - 1, Math.max(0, Math.floor(y / scaleH)));
    for (let x = 0; x < tw; x++) {
      const ox = Math.min(ow - 1, Math.max(0, Math.floor(x / scaleW)));
      const p = probs[oy * ow + ox];
      mask[y * tw + x] = p >= thr ? 255 : 0;
    }
  }
  // Dynamic minimum box size tied to output resolution (very small to capture tiny labels)
  const minDimPx = Math.max(2, Math.round(Math.min(tw, th) * 0.003)); // ~0.3% of shorter side
  const minAreaPx = Math.max(9, minDimPx * minDimPx);

  // Try OpenCV contouring first. If not available or returns none, fall back to JS CCL.
  let boxes = [];
  if (cv && cv.Mat) {
    const srcMat = cv.matFromArray(th, tw, cv.CV_8UC1, mask);
    // Light morphology to connect text blobs
    try {
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.morphologyEx(srcMat, srcMat, cv.MORPH_CLOSE, kernel, new cv.Point(-1,-1), 1);
      kernel.delete();
    } catch {}
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(srcMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const rect = cv.boundingRect(cnt);
      if (rect.width < minDimPx || rect.height < minDimPx || (rect.width * rect.height) < minAreaPx) { cnt.delete(); continue; }
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const ux = Math.max(0, Math.floor(cx - rect.width * 0.6));
      const uy = Math.max(0, Math.floor(cy - rect.height * 0.6));
      const uw = Math.min(tw - ux, Math.floor(rect.width * 1.2));
      const uh = Math.min(th - uy, Math.floor(rect.height * 1.2));
      const ox = (ux - dx) / scale;
      const oy = (uy - dy) / scale;
      const owx = uw / scale;
      const ohx = uh / scale;
      const xN = Math.max(0, ox / iw), yN = Math.max(0, oy / ih);
      const wN = Math.max(0, owx / iw), hN = Math.max(0, ohx / ih);
      if (wN > 0 && hN > 0) boxes.push({ xN, yN, wN, hN, score: 1 });
      cnt.delete();
    }
    contours.delete(); hierarchy.delete(); srcMat.delete();
  }
  if (!boxes || boxes.length === 0) {
    // Fallback: simple connected-component labeling (4-connectivity) in JS
    const used = new Uint8Array(ow * oh);
    const minCells = Math.max(4, Math.round((minDimPx/scaleW) * (minDimPx/scaleH))); // translate px to grid cells
    for (let y0 = 0; y0 < oh; y0++) {
      for (let x0 = 0; x0 < ow; x0++) {
        const idx0 = y0 * ow + x0;
        if (used[idx0]) continue;
        if (probs[idx0] < thr) { used[idx0] = 1; continue; }
        // BFS
        let qx = [x0], qy = [y0]; used[idx0] = 1;
        let head = 0;
        let minx = x0, miny = y0, maxx = x0, maxy = y0, cells = 0;
        while (head < qx.length && cells < 50000) {
          const x = qx[head], y = qy[head]; head++; cells++;
          if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y;
          // 4-neighbors
          const nbrs = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
          for (const [nx, ny] of nbrs) {
            if (nx<0||ny<0||nx>=ow||ny>=oh) continue;
            const k = ny*ow+nx;
            if (used[k]) continue;
            if (probs[k] >= thr) { used[k]=1; qx.push(nx); qy.push(ny); } else { used[k]=1; }
          }
        }
        if (cells >= minCells) {
          // Map component box back to original image via letterbox mapping
          const ux = Math.max(0, Math.floor(minx * (tw/ow)));
          const uy = Math.max(0, Math.floor(miny * (th/oh)));
          const uw = Math.min(tw - ux, Math.ceil((maxx - minx + 1) * (tw/ow)));
          const uh = Math.min(th - uy, Math.ceil((maxy - miny + 1) * (th/oh)));
          const ox = (ux - dx) / scale;
          const oy = (uy - dy) / scale;
          const owx = uw / scale;
          const ohx = uh / scale;
          const xN = Math.max(0, ox / iw), yN = Math.max(0, oy / ih);
          const wN = Math.max(0, owx / iw), hN = Math.max(0, ohx / ih);
          if (wN > 0 && hN > 0) boxes.push({ xN, yN, wN, hN, score: 1 });
        }
      }
    }
  }
  return boxes;
}
