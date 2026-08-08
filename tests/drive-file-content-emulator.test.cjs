const assert = require("node:assert/strict");
const { after, before, describe, it } = require("node:test");
const admin = require("../drive/node_modules/firebase-admin");

const projectId = "security-rules-audit";
const endpoint = `http://127.0.0.1:5001/${projectId}/us-central1/driveFileContent?fileId=preflight-test`;

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function emulatorIdToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "none", typ: "JWT" };
  const payload = {
    aud: projectId,
    auth_time: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: "custom" },
    iat: now,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: uid,
    user_id: uid,
  };
  return `${base64Url(header)}.${base64Url(payload)}.`;
}

async function preflight(origin) {
  return fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
}

describe("driveFileContent en emulador", () => {
  before(async () => {
    admin.initializeApp({ projectId }, "drive-content-test");
    await admin.app("drive-content-test").auth().createUser({ uid: "cors-user" });
    await admin.app("drive-content-test").firestore().doc("users/cors-user").set({
      active: true,
      role: "sin-acceso-nube",
    });
  });

  after(async () => admin.app("drive-content-test").delete());

  it("acepta preflight de web.app con Authorization y Content-Type", async () => {
    const response = await preflight("https://sistema-desarrollo-proyectos.web.app");
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://sistema-desarrollo-proyectos.web.app");
    assert.match(response.headers.get("access-control-allow-headers") || "", /authorization/i);
    assert.match(response.headers.get("access-control-allow-headers") || "", /content-type/i);
  });

  it("acepta preflight de localhost", async () => {
    const response = await preflight("http://localhost:5173");
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  });

  it("un origen ajeno no evita la autenticación", async () => {
    const response = await fetch(endpoint, { headers: { Origin: "https://evil.example" } });
    assert.equal(response.status, 401);
  });

  it("mantiene autenticación después del preflight", async () => {
    const withoutToken = await fetch(endpoint, {
      headers: { Origin: "https://sistema-desarrollo-proyectos.web.app" },
    });
    assert.equal(withoutToken.status, 401);
    assert.equal(withoutToken.headers.get("access-control-allow-origin"), "https://sistema-desarrollo-proyectos.web.app");

    const authenticated = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${emulatorIdToken("cors-user")}`,
        Origin: "https://sistema-desarrollo-proyectos.web.app",
      },
    });
    assert.equal(authenticated.status, 403);
    const payload = await authenticated.json();
    assert.equal(payload.error.code, "permission-denied");
    assert.equal(authenticated.headers.get("access-control-allow-origin"), "https://sistema-desarrollo-proyectos.web.app");
  });
});
