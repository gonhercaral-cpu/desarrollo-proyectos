import { useEffect, useRef, useState } from "react";
import { getBuildPreview } from "../services/unitEditorService";

const MAX_CONCURRENT_PREVIEWS = 3;
const queue = [];
let running = 0;
function pump() {
  while (running < MAX_CONCURRENT_PREVIEWS && queue.length) {
    const job = queue.shift();
    if (job.cancelled) continue;
    running++;
    Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { running--; pump(); });
  }
}
function enqueue(task) {
  const job = { task, cancelled: false };
  const promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  queue.push(job); pump();
  return { promise, cancel: () => { job.cancelled = true; } };
}

// Mismo estado que muestra SlideInteractionEditor por defecto: imagen inicial, estado 0 automático o estado final estático.
function thumbnailTarget(main, slide) {
  const pageObjectId = slide.metadata?.pageObjectId;
  const initialResourceId = slide.interaction?.initialResourceId || "";
  if (initialResourceId) return { resourceId: initialResourceId, pageObjectId: undefined, buildIndex: 0 };
  if (!main || !pageObjectId) return null;
  const automatic = slide.interaction?.source === "pptx";
  const mode = slide.interactionMode || slide.interaction?.mode || "static";
  const page = main.processing?.pages?.find(item => item.pageObjectId === pageObjectId);
  return { resourceId: main.id, pageObjectId, buildIndex: automatic ? 0 : mode === "static" ? page?.builds?.length || 0 : 0 };
}

export default function SlideThumbnail({ unitId, main, slide, index }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState({ key: "", asset: null });
  const [failedUrl, setFailedUrl] = useState("");
  const target = thumbnailTarget(main, slide);
  const key = target ? `${unitId}|${target.resourceId}|${target.pageObjectId || ""}|${target.buildIndex}|${main?.version || 0}|${main?.processing?.revision || ""}` : "";
  useEffect(() => {
    if (!key || visible) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "120px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [key, visible]);
  useEffect(() => {
    if (!key || !visible) return;
    const [, resourceId, pageObjectId, buildIndex] = key.split("|");
    let active = true;
    const request = enqueue(() => getBuildPreview(unitId, resourceId, pageObjectId || undefined, Number(buildIndex)));
    request.promise.then(asset => { if (active) setState({ key, asset }); }).catch(() => {});
    return () => { active = false; request.cancel(); };
  }, [key, visible, unitId]);
  const asset = state.key === key ? state.asset : null;
  return <span className="ac-slide-thumb" ref={ref} aria-hidden="true">{asset && asset.mimeType !== "application/pdf" && asset.url !== failedUrl ? <img src={asset.url} alt="" loading="lazy" onError={() => setFailedUrl(asset.url)} /> : <span className="ac-slide-thumb-number">{index + 1}</span>}</span>;
}
