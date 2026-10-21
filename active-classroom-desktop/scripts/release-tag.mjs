import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseRepository } from "./updater-release.mjs";

export async function readReleaseTag(request, tag, token) {
  if (!/^active-classroom-v\d+\.\d+\.\d+$/.test(tag)) throw new Error("Tag de release inválido");
  const response = await request(`https://api.github.com/repos/${releaseRepository}/git/ref/tags/${encodeURIComponent(tag)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30000),
  });
  // A failed gh api call can still write an error body to stdout. Never turn
  // that body (or null from --jq) into an apparently existing tag.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`No se pudo comprobar el tag: HTTP ${response.status}`);
  let value;
  try { value = await response.json(); } catch { throw new Error("Respuesta de tag no válida"); }
  if (!value || typeof value !== "object" || value.ref !== `refs/tags/${tag}` || value.object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(value.object?.sha || "")) throw new Error("Referencia de tag inesperada; no se modificó");
  return value.object.sha;
}

async function main() {
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const tag = process.argv[2];
  if (tag !== `active-classroom-v${version}` || process.env.GH_REPO !== releaseRepository || !process.env.GH_TOKEN) throw new Error("Contexto de release inválido");
  const sha = await readReleaseTag(fetch, tag, process.env.GH_TOKEN);
  // Only a validated SHA or empty successful output reaches shell substitution.
  // Permission, network and server failures abort the release before tag creation.
  process.stdout.write(sha || "");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
