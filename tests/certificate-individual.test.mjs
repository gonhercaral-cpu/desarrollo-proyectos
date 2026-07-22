import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/printshop.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/app/modules/11-final-polish.css", import.meta.url), "utf8");

test("certificado individual usa motor completo, Storage y registro antes de mostrar resultado", () => {
  const start = source.indexOf("async function prepareStandaloneCertificate");
  const end = source.indexOf("return (", start);
  const flow = source.slice(start, end);

  assert.match(flow, /buildDetachedCertificatePdfBlob/);
  assert.match(flow, /saveGeneratedCertificatePdfBlob/);
  assert.match(flow, /onRegisterStandaloneGeneratedCertificate/);
  assert.match(flow, /setStandalonePreview/);
  assert.ok(flow.indexOf("buildDetachedCertificatePdfBlob") < flow.indexOf("setStandalonePreview"));
  assert.ok(flow.indexOf("saveGeneratedCertificatePdfBlob") < flow.indexOf("onRegisterStandaloneGeneratedCertificate"));
});

test("vista individual conserva hoja Letter completa, centrada y escalada sin recorte interno", () => {
  assert.match(styles, /\.certificate-generator-preview-panel \.certificate-preview-viewport\s*\{[^}]*aspect-ratio:\s*8\.5\s*\/\s*11/s);
  assert.match(styles, /\.certificate-generator-preview-panel \.certificate-preview-scale-layer\s*\{[^}]*top:\s*50%[^}]*left:\s*50%/s);
  assert.match(styles, /\.certificate-generator-preview-panel \.certificate-preview-stage\s*\{[^}]*height:\s*var\(--certificate-page-height\)\s*!important/s);
  assert.match(styles, /\.certificate-generator-preview-panel \.certificate-preview-scale-layer\.pdf-export-active/);
});

test("certificado individual expone abrir PDF, descargar, imprimir y editar", () => {
  const start = source.indexOf("function CertificatePreviewCard");
  const end = source.indexOf("function CertificateTemplateOverlay", start);
  const card = source.slice(start, end);

  assert.match(card, /Abrir PDF para impresión/);
  assert.match(card, /Descargar PDF/);
  assert.match(card, /Imprimir/);
  assert.match(card, /Volver a editar/);
  assert.match(card, /renderCertificatePrintWindow/);
  assert.match(source, /await document\.fonts\.ready/);
  assert.match(source, /await waitForCertificateAssets\(element\)/);
});
