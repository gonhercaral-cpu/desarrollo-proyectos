const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createVertexProvider, vertexEndpoint, buildVertexRequest, tokenReservation, analysisKey } = require("../functions/projectSupervisionAI");
const { DEFAULT_CONFIG } = require("../functions/projectSupervisionEngine");
const config = { ...DEFAULT_CONFIG, aiModel: "gemini-3.5-flash-lite" };
const sources = [{ id: "advance:a1", type: "advance", text: "Se completó la documentación.", contentAnalyzed: true }];
const analysis = { facts: [{ text: "Se registró documentación completada.", sourceIds: ["advance:a1"] }], inferences: [], recommendations: [] };
const credential = { getAccessToken: async () => ({ access_token: "test-token-not-a-secret" }) };
function response(parts, finishReason = "STOP") {
  return { ok: true, json: async () => ({ candidates: [{ finishReason, content: { parts } }], usageMetadata: { totalTokenCount: 450 } }) };
}

test("rutas revisadas: multirregión US/EU y global explícito", () => {
  for (const [location, origin] of [["us", "https://aiplatform.us.rep.googleapis.com"], ["eu", "https://aiplatform.eu.rep.googleapis.com"], ["global", "https://aiplatform.googleapis.com"]]) {
    assert.equal(vertexEndpoint("test-project", config.aiModel, location), `${origin}/v1/projects/test-project/locations/${location}/publishers/google/models/gemini-3.5-flash-lite:generateContent`);
  }
  assert.throws(() => vertexEndpoint("test-project", config.aiModel, "us-central1"), /unsupported-location/);
  assert.throws(() => vertexEndpoint("test-project", "gemini-2.5-flash", "us"), /unsupported-model/);
  assert.throws(() => vertexEndpoint("test/path", config.aiModel, "us"), /invalid-project/);
});

test("incompatibilidades se rechazan antes de obtener credenciales o llamar al proveedor", async () => {
  let authCalls = 0, networkCalls = 0;
  const provider = createVertexProvider({ projectId: "test-project", location: "us-central1", credential: { getAccessToken: async () => { authCalls++; } }, fetchImpl: async () => { networkCalls++; } });
  await assert.rejects(provider({ sources, config }), /unsupported-location/);
  assert.equal(authCalls, 0); assert.equal(networkCalls, 0);
});

test("modelo vigente usa MINIMAL, esquema estructurado y no expone herramientas ni parámetros antiguos", async () => {
  let capturedUrl, capturedBody;
  const provider = createVertexProvider({ projectId: "test-project", credential, fetchImpl: async (url, options) => {
    capturedUrl = url; capturedBody = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, "Bearer test-token-not-a-secret");
    return response([{ text: JSON.stringify(analysis) }]);
  } });
  const result = await provider({ sources, config });
  assert.ok(capturedUrl.startsWith("https://aiplatform.us.rep.googleapis.com/"));
  assert.deepEqual(capturedBody.generationConfig.thinkingConfig, { thinkingLevel: "MINIMAL" });
  assert.equal(capturedBody.generationConfig.temperature, undefined);
  assert.equal(capturedBody.generationConfig.maxOutputTokens, 1000);
  assert.equal(capturedBody.tools, undefined);
  assert.deepEqual(capturedBody.generationConfig.responseSchema.required, ["facts", "inferences", "recommendations"]);
  assert.equal(result.location, "us"); assert.equal(result.tokenCount, 450);
});

test("ignora partes de razonamiento y no concatena pensamientos internos en el JSON", async () => {
  const provider = createVertexProvider({ projectId: "test-project", credential, fetchImpl: async () => response([{ thought: true, text: "Contenido interno de prueba que no debe guardarse." }, { text: JSON.stringify(analysis) }]) });
  const result = await provider({ sources, config });
  assert.deepEqual(result.facts, analysis.facts);
  assert.equal(JSON.stringify(result).includes("Contenido interno"), false);
});

test("rechaza respuestas truncadas, inválidas y citas inventadas", async () => {
  for (const reply of [response([{ text: JSON.stringify(analysis) }], "MAX_TOKENS"), response([{ text: "no es json" }]), response([{ text: JSON.stringify({ ...analysis, facts: [{ text: "No sustentado", sourceIds: ["fake"] }] }) }])]) {
    const provider = createVertexProvider({ projectId: "test-project", credential, fetchImpl: async () => reply });
    await assert.rejects(provider({ sources, config }));
  }
});

test("límite de entrada se verifica antes de la llamada facturable", async () => {
  let called = false;
  const provider = createVertexProvider({ projectId: "test-project", credential, fetchImpl: async () => { called = true; } });
  await assert.rejects(provider({ sources: [{ id: "a", text: "x".repeat(13000) }], config }), /input-limit/);
  assert.equal(called, false);
});

test("reserva incluye UTF-8 del payload completo, esquema, sistema, salida y margen", () => {
  const input = [{ id: "á", text: "Documentación 📋" }];
  const payloadBytes = Buffer.byteLength(JSON.stringify(buildVertexRequest(input, config)), "utf8");
  assert.equal(tokenReservation(input, config), payloadBytes + config.aiMaxOutputTokens + 256);
  assert.ok(payloadBytes > Buffer.byteLength(JSON.stringify({ sources: input }), "utf8"));
});

test("caché se invalida al cambiar ubicación, modelo o revisión de fuentes", () => {
  const summary = { version: "v1" };
  const base = analysisKey(summary, config, "us");
  assert.equal(base, analysisKey(summary, config, "us"));
  assert.notEqual(base, analysisKey(summary, config, "global"));
  assert.notEqual(base, analysisKey({ version: "v2" }, config, "us"));
  assert.notEqual(base, analysisKey(summary, { ...config, aiModel: "gemini-other" }, "us"));
});
