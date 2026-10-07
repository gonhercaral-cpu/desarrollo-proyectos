import { scroll, observations } from "./media-browser.mjs";
async function run() {
  try {
    const manifest = await (await fetch("/fixture")).json();
    await scroll(manifest);
    return { ok: true, observations };
  } catch (error) { return { ok: false, message: String(error), observations }; }
}
void run().then(result => window.webkit.messageHandlers.result.postMessage(JSON.stringify(result)));
