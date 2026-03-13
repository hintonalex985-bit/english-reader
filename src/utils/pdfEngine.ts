import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite's ?url import for the worker file
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure the worker with fallback
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
} catch (e) {
  console.warn('Failed to set worker URL, using CDN fallback:', e);
  // Fallback to CDN worker for browsers that can't handle the bundled worker
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export { pdfjsLib };
