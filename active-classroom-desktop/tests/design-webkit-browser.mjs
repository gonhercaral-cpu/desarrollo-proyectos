import { scroll, observations } from "./media-browser.mjs";
import "../src/design-system.css";
import "../src/styles.css";
import "../src/player/player.css";
async function run() {
  try {
    const manifest = await (await fetch("/fixture")).json();
    await scroll(manifest);
    return { ok: true, observations };
  } catch (error) { return { ok: false, message: String(error), observations }; }
}
void run().then(result => window.webkit.messageHandlers.result.postMessage(JSON.stringify(result)));
