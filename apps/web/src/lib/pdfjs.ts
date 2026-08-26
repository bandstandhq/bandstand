// SPDX-License-Identifier: Apache-2.0
//
// One place to configure pdf.js's worker — every caller (the upload flow's
// page-count probe, PdfVoiceViewer's actual rendering) imports from here
// instead of touching pdfjs-dist's GlobalWorkerOptions directly.
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib };
