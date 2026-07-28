import assert from "node:assert/strict";
import test from "node:test";
import {
  getSupplyImageStoragePath,
  SUPPLY_IMAGE_MAX_BYTES,
  validateSupplyImageFile,
} from "../src/utils/supplyImage.js";

test("construye una ruta estable por insumo", () => {
  assert.equal(
    getSupplyImageStoragePath("supply-123"),
    "printshop/supplies/supply-123/product-image.webp"
  );
});

test("valida formato y tamaño de la fotografía", () => {
  assert.equal(validateSupplyImageFile({ type: "image/jpeg", size: 1024 }), "");
  assert.match(validateSupplyImageFile({ type: "image/gif", size: 1024 }), /JPEG/);
  assert.match(
    validateSupplyImageFile({ type: "image/webp", size: SUPPLY_IMAGE_MAX_BYTES + 1 }),
    /5 MB/
  );
});
