const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { planFastStart, relocatedMoov, relocatedStream } = require("../drive/activeClassroomVideoDelivery");
const box = (type, payload = Buffer.alloc(0)) => { const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4); return Buffer.concat([header, payload]); };
function fixture(front = false) {
  const table = Buffer.alloc(12); table.writeUInt32BE(1, 4);
  const makeMoov = () => box("moov", box("trak", box("mdia", box("minf", box("stbl", box("stco", table))))));
  const ftyp = box("ftyp", Buffer.from("isom0000")); const sample = Buffer.from("encoded-video-sample-unchanged"); const mdat = box("mdat", sample);
  table.writeUInt32BE(ftyp.length + 8 + (front ? makeMoov().length : 0), 8); const moov = makeMoov();
  return { bytes: Buffer.concat(front ? [ftyp, moov, mdat] : [ftyp, mdat, moov]), sample };
}
const source = bytes => ({ createReadStream({ start, end }) { return Readable.from([bytes.subarray(start, end + 1)]); } });
test("faststart mueve índice y corrige offsets sin cambiar samples, tamaño/hash nuevos", async () => {
  const { bytes, sample } = fixture(); const file = source(bytes); const plan = await planFastStart(file, bytes.length); const layout = relocatedMoov(plan);
  const chunks = []; for await (const chunk of relocatedStream(file, plan, layout)) chunks.push(chunk); const output = Buffer.concat(chunks);
  assert.equal(output.length, layout.size); assert.ok(output.indexOf(Buffer.from("moov")) < output.indexOf(Buffer.from("mdat")));
  assert.equal(output.subarray(output.indexOf(Buffer.from("mdat")) + 4).equals(sample), true);
  const index = output.indexOf(Buffer.from("co64")); assert.ok(index > 0);
  assert.equal(Number(output.readBigUInt64BE(index + 12)), output.indexOf(sample));
  assert.equal(bytes.toString("hex"), fixture().bytes.toString("hex"), "original inmutable");
  assert.equal(await planFastStart(source(output), output.length), null, "ya optimizado no se duplica");
});
test("video faststart existente conserva bytes exactos y publicación antigua", async () => {
  const { bytes } = fixture(true); assert.equal(await planFastStart(source(bytes), bytes.length), null);
});
test("faststart inspecciona archivos de 10 GiB sin leer mdat a memoria y promueve co64", async () => {
  const { bytes } = fixture(); const small = await planFastStart(source(bytes), bytes.length); const size = 10 * 1024 ** 3;
  const moov = Buffer.from(small.moov); moov.writeUInt32BE(32, moov.indexOf(Buffer.from("stco")) + 12); const ftyp = bytes.subarray(0, 16); const header = Buffer.alloc(16); header.writeUInt32BE(1); header.write("mdat", 4); header.writeBigUInt64BE(BigInt(size - ftyp.length - moov.length), 8);
  let readBytes = 0; const file = { createReadStream({ start, end }) { let result;
    if (start === 0) result = ftyp; else if (start === 16) result = header;
    else if (start === size - moov.length) result = moov.subarray(0, end - start + 1); else throw new Error("Intento de leer mdat durante planificación");
    readBytes += result.length; return Readable.from([result]);
  } };
  const plan = await planFastStart(file, size); assert.ok(readBytes < 1024); assert.ok(relocatedMoov(plan).moov.includes(Buffer.from("co64")));
});
test("índice corrupto/rangos truncados y cancelación fallan sin emitir publicación", async () => {
  await assert.rejects(planFastStart(source(Buffer.alloc(32, 255)), 32));
  const { bytes } = fixture(); await assert.rejects(planFastStart({ createReadStream() { return Readable.from([Buffer.alloc(2)]); } }, bytes.length));
  await assert.rejects(planFastStart(source(bytes), bytes.length, AbortSignal.abort()));
});
test("índices auxiliares protegidos no se reubican sin corregir sus offsets", () => {
  const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", box("saio", Buffer.alloc(16)))))));
  const { rewriteMoov } = require("../drive/activeClassroomVideoDelivery"); assert.throws(() => rewriteMoov(moov), { code: "data-loss" });
});
