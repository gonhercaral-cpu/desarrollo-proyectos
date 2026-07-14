import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDepartmentReadReceipt, parseMessageText } from "../src/utils/messageUtils.js";

describe("texto de mensajes", () => {
  it("detecta URLs HTTP, HTTPS y www sin consumir puntuación", () => {
    const parts = parseMessageText(
      "Uno http://ejemplo.test, dos https://seguro.test/ruta. tres www.sitio.test!"
    );
    const links = parts.filter((part) => part.type === "link");

    assert.deepEqual(
      links.map(({ value, href }) => ({ value, href })),
      [
        { value: "http://ejemplo.test", href: "http://ejemplo.test" },
        { value: "https://seguro.test/ruta", href: "https://seguro.test/ruta" },
        { value: "www.sitio.test", href: "https://www.sitio.test" },
      ]
    );
    assert.equal(parts.map((part) => part.value).join(""), "Uno http://ejemplo.test, dos https://seguro.test/ruta. tres www.sitio.test!");
  });

  it("conserva saltos de línea como texto", () => {
    const input = "Primera línea\nhttps://ejemplo.test\nÚltima línea";
    assert.equal(parseMessageText(input).map((part) => part.value).join(""), input);
  });
});

describe("lecturas departamentales", () => {
  it("excluye al remitente y obtiene nombres desde perfiles", () => {
    const receipt = getDepartmentReadReceipt(
      {
        fromUserId: "sender",
        readBy: { sender: {}, reader: {}, unnamed: {}, missing: {} },
      },
      [
        { id: "sender", name: "Remitente" },
        { id: "reader", name: "Ana" },
        { id: "unnamed", email: "sin-nombre@test.local" },
      ]
    );

    assert.equal(receipt.count, 3);
    assert.deepEqual(receipt.names, ["Ana", "sin-nombre@test.local", "Usuario sin nombre"]);
  });
});
