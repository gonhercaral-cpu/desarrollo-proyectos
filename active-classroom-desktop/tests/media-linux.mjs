import { build } from "vite";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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
  // Actual encoded samples, not sparse/container padding. Remux a noisy seed
  // to exercise seeks into a >500 MiB mdat without minutes of CI encoding.
  const seed = join(directory, "encoded-seed.mp4");
  command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-f", "lavfi", "-i", "sine=frequency=660", "-vf", "noise=alls=40:allf=t", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", "-profile:v", "baseline", "-c:a", "aac", "-movflags", "+faststart", "-y", seed]);
  const repeat = Math.ceil(550 * 1024 * 1024 / (await stat(seed)).size);
  const encoded = join(directory, "encoded-large.mp4");
  command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-stream_loop", String(repeat - 1), "-i", seed, "-c", "copy", "-movflags", "+faststart", "-y", encoded]);
  assert.ok((await stat(encoded)).size > 500 * 1024 * 1024, "MP4 codificado debe superar 500 MiB");
  command("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type", "-of", "json", encoded]);
  await rm(seed);
  command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220", "-t", "8", "-y", join(directory, "music.wav")]);
  const drawing = "1 0 0 rg 0 0 200 200 re f";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>", `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await writeFile(join(directory, "transition.pdf"), pdf);
  for (const [index, color] of ["red", "green", "blue"].entries()) command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", "-threads", "1", "-y", join(directory, `state-${index}.png`)]);
  const bundle = await build({ configFile: false, logLevel: "error", build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./media-browser.mjs", import.meta.url)), name: "MediaAcceptance", formats: ["iife"] } } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle).output;
  const css = output.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => item.source).join("\n");
  const script = join(directory, "media.js"); await writeFile(script, `const fixtureStyle = document.createElement("style"); fixtureStyle.textContent = ${JSON.stringify(css)}; document.head.append(fixtureStyle);\n` + output.find(item => item.type === "chunk").code);
  command("cargo", ["build", "--release", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--example", "media_playback"]);
  // Cloud CI cannot create nested sandbox namespaces or use a hardware GPU.
  // These settings apply only to this test process, never the installed app.
  if (process.env.ACTIVE_CLASSROOM_MEDIA_EXPORT) {
    const destination = process.env.ACTIVE_CLASSROOM_MEDIA_EXPORT;
    await mkdir(destination, { recursive: true });
    for (const name of ["h264-aac.mp4", "encoded-large.mp4", "music.wav", "transition.pdf", "media.js", "state-0.png", "state-1.png", "state-2.png"]) await copyFile(join(directory, name), join(destination, name));
    await copyFile("src-tauri/target/release/examples/media_playback", join(destination, "media_playback"));
  } else {
    const executable = process.env.ACTIVE_CLASSROOM_MEDIA_RUNTIME || "src-tauri/target/release/examples/media_playback";
    command("xvfb-run", ["-a", "dbus-run-session", "--", executable], { env: { ...process.env, GDK_BACKEND: "x11", WEBKIT_DISABLE_COMPOSITING_MODE: "1", WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", ACTIVE_CLASSROOM_MEDIA_FIXTURE: fixture, ACTIVE_CLASSROOM_MEDIA_SCRIPT: script }, timeout: 145000 });
  }
} finally { await rm(directory, { recursive: true, force: true }); }
