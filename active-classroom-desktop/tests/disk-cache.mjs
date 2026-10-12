import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, appendFile, rename, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { canonical, validateManifest, SyncError } from "../src/offline/manifest.ts";
export class DiskCache {
  constructor(root) { this.root = root; this.full = false; }
  object(hash) { return join(this.root, "objects", hash); }
  part(hash) { return join(this.root, "temporary", hash); }
  version(manifest) { return join(this.root, "units", manifest.unit.unitId, "versions", String(manifest.version)); }
  async list() {
    const selected = [];
    for (const unit of await readdir(join(this.root, "units")).catch(() => [])) {
      const versions = (await readdir(join(this.root, "units", unit, "versions"))).map(Number).sort((a, b) => b - a);
      for (const version of versions) {
        try { selected.push((await this.open(unit, version)).manifest); break; } catch { /* Uncommitted/corrupt versions are invisible. */ }
      }
    }
    return selected;
  }
  async matches(path, hash, size) {
    try { if ((await stat(path)).size !== size) return false; const digest = createHash("sha256"); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest("hex") === hash; } catch { return false; }
  }
  async has(hash, size) { return this.matches(this.object(hash), hash, size); }
  async begin(hash) { await mkdir(join(this.root, "temporary"), { recursive: true }); await writeFile(this.part(hash), ""); }
  async append(hash, offset, chunk) {
    if (this.full) throw new SyncError("disk-full", "Espacio insuficiente");
    assert.equal((await stat(this.part(hash))).size, offset);
    await appendFile(this.part(hash), chunk);
  }
  async finish(hash, size) {
    if (!await this.matches(this.part(hash), hash, size)) throw new SyncError("integrity", "SHA-256 incorrecto");
    await mkdir(join(this.root, "objects"), { recursive: true });
    await rename(this.part(hash), this.object(hash));
  }
  async discard(hash) { await rm(this.part(hash), { force: true }); }
  async pending() {
    const manifests = [];
    for (const unit of await readdir(join(this.root, "units")).catch(() => [])) for (const version of await readdir(join(this.root, "units", unit, "versions"))) {
      try { const manifest = await validateManifest(JSON.parse(await readFile(join(this.root, "units", unit, "versions", version, "manifest.staged"), "utf8"))); for (const resource of manifest.resources) assert.ok(await this.has(resource.download.checksums.sha256, resource.download.sizeBytes)); manifests.push(manifest); } catch { /* Incomplete states stay invisible. */ }
    }
    return manifests;
  }
  async stage(manifest) {
    await validateManifest(manifest);
    for (const resource of manifest.resources) assert.ok(await this.has(resource.download.checksums.sha256, resource.download.sizeBytes));
    await mkdir(this.version(manifest), { recursive: true });
    await writeFile(join(this.version(manifest), "manifest.staged"), JSON.stringify(manifest));
  }
  async commit(manifest) {
    await validateManifest(manifest);
    for (const resource of manifest.resources) if (!await this.has(resource.download.checksums.sha256, resource.download.sizeBytes)) throw new SyncError("integrity", "Archivo ausente");
    const directory = this.version(manifest);
    await mkdir(directory, { recursive: true });
    const previous = await readFile(join(directory, "manifest.json"), "utf8").catch(() => null);
    if (previous && canonical(JSON.parse(previous)) !== canonical(manifest)) throw new SyncError("version", "Versión inmutable");
    await writeFile(join(directory, "manifest.pending"), JSON.stringify(manifest));
    await rename(join(directory, "manifest.pending"), join(directory, "manifest.json"));
    await rm(join(directory, "manifest.staged"), { force: true });
  }
  async open(unitId, version) {
    const manifest = await validateManifest(JSON.parse(await readFile(join(this.root, "units", unitId, "versions", String(version), "manifest.json"), "utf8")));
    const paths = {};
    for (const resource of manifest.resources) {
      assert.ok(await this.has(resource.download.checksums.sha256, resource.download.sizeBytes));
      paths[resource.resourceId] = this.object(resource.download.checksums.sha256);
    }
    return { manifest, paths };
  }
}

