// OCR WORKER SINGLETON — concise overview
// Keeps one Tesseract worker alive across calls for better performance.
import { createWorker } from 'tesseract.js';

let workerPromise = null;

// Get (or create) the one worker we use everywhere.
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker({
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/tesseract-core.wasm.js',
        workerBlobURL: false,
        logger: process.env.NODE_ENV === 'development' ? (m) => { /* console.debug(m); */ } : undefined,
      });
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      return worker;
    })();
  }
  return workerPromise;
}

// Read text from an image/canvas/dataURL and give back the string.
export async function ocrImage(imageLike) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageLike);
  return data.text || '';
}

// Politely tell the worker to go home (used on shutdown).
export async function terminateOcr() {
  if (workerPromise) {
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch {}
    workerPromise = null;
  }
}
