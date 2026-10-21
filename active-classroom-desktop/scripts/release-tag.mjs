import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseRepository } from "./updater-release.mjs";

const NOT_FOUND = Symbol("not-found");

async function readGitHub(request, path, token) {
  const response = await request(`https://api.github.com/repos/${releaseRepository}/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30000),
  });
  // A failed gh api call can still write an error body to stdout. Never turn
  // that body (or null from --jq) into an apparently existing tag.
  if (response.status === 404) return NOT_FOUND;
  if (!response.ok) throw new Error(`No se pudo comprobar el tag: HTTP ${response.status}`);
  try { return await response.json(); } catch { throw new Error("Respuesta de tag no válida"); }
}

export async function readReleaseTag(request, tag, token) {
  if (!/^active-classroom-v\d+\.\d+\.\d+$/.test(tag)) throw new Error("Tag de release inválido");
  const value = await readGitHub(request, `git/ref/tags/${encodeURIComponent(tag)}`, token);
  if (value === NOT_FOUND) return null;
  if (!value || typeof value !== "object" || value.ref !== `refs/tags/${tag}` || value.object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(value.object?.sha || "")) throw new Error("Referencia de tag inesperada; no se modificó");
  return value.object.sha;
}

export async function readLatestRelease(request, token) {
  const value = await readGitHub(request, "releases/latest", token);
  if (value === NOT_FOUND) return null;
  if (!value || !/^active-classroom-v\d+\.\d+\.\d+$/.test(value.tag_name || "") || value.draft !== false || value.prerelease !== false) throw new Error("Última release estable inesperada");
  return value.tag_name;
}

async function main() {
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const action = process.argv[2];
  if (process.env.GH_REPO !== releaseRepository || !process.env.GH_TOKEN) throw new Error("Contexto de release inválido");
  if (action === "--preflight") {
    const [latest, sha] = await Promise.all([readLatestRelease(fetch, process.env.GH_TOKEN), readReleaseTag(fetch, `active-classroom-v${version}`, process.env.GH_TOKEN)]);
    console.info(`RELEASE_LOOKUPS_OK version=${version} latest=${latest || "none"} tag=${sha || "absent"}`);
    return;
  }
  if (action === "--latest") { process.stdout.write(await readLatestRelease(fetch, process.env.GH_TOKEN) || ""); return; }
  if (action !== `active-classroom-v${version}`) throw new Error("Tag no corresponde a la versión compilada");
  const sha = await readReleaseTag(fetch, action, process.env.GH_TOKEN);
  // Only a validated SHA or empty successful output reaches shell substitution.
  // Permission, network and server failures abort the release before tag creation.
  process.stdout.write(sha || "");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
