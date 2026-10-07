import { build } from "vite";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const directory = await mkdtemp(join(tmpdir(), "classroom-media-ci-"));
const command = (program, args, options = {}) => { const result = spawnSync(program, args, { stdio: "inherit", ...options }); assert.equal(result.status, 0, `${program} falló`); };
try {
  const fixture = join(directory, "h264-aac.mp4");
  command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "baseline", "-level:v", "3.0", "-c:a", "aac", "-y", fixture]);
  command("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type", "-of", "json", fixture]);
  const bundle = await build({ configFile: false, logLevel: "error", build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./media-browser.mjs", import.meta.url)), name: "MediaAcceptance", formats: ["iife"] } } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle).output;
  const css = output.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => item.source).join("\n");
  const script = join(directory, "media.js"); await writeFile(script, `const fixtureStyle = document.createElement("style"); fixtureStyle.textContent = ${JSON.stringify(css)}; document.head.append(fixtureStyle);\n` + output.find(item => item.type === "chunk").code);
  command("cargo", ["build", "--release", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--example", "media_playback"]);
  // Cloud CI cannot create nested sandbox namespaces or use a hardware GPU.
  // These settings apply only to this test process, never the installed app.
  command("xvfb-run", ["-a", "dbus-run-session", "--", "src-tauri/target/release/examples/media_playback"], { env: { ...process.env, GDK_BACKEND: "x11", WEBKIT_DISABLE_COMPOSITING_MODE: "1", WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", ACTIVE_CLASSROOM_MEDIA_FIXTURE: fixture, ACTIVE_CLASSROOM_MEDIA_SCRIPT: script }, timeout: 85000 });
} finally { await rm(directory, { recursive: true, force: true }); }
