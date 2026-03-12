import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite's ?url import for the worker file
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Use the bundled worker URL from Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
