import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
export function loadPdf(data: Uint8Array) {
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  return getDocument({
    data, cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`, enableXfa: false,
  });
}
