import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFontOptions, fontRecordVariant, fontVariantKey } from "../models/editorialFonts";
import { subscribeEditorialFonts, uploadEditorialFont } from "../services/editorialFontsService";

const FONT_FORMATS = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };

export function useEditorialFonts(projectId, user) {
  const [fonts, setFonts] = useState([]);
  const [loadedVariants, setLoadedVariants] = useState(new Set());
  const [failedVariants, setFailedVariants] = useState(new Set());
  const [error, setError] = useState("");
  const loadingRef = useRef(new Set());

  useEffect(() => {
    if (!projectId) return undefined;
    return subscribeEditorialFonts({ projectId, onChange: setFonts, onError: (next) => setError(next.message || "No fue posible cargar fuentes.") });
  }, [projectId]);

  useEffect(() => {
    if (typeof FontFace === "undefined" || !document.fonts) return;
    fonts.forEach((font) => {
      if (!font.url) return;
      const variant = fontRecordVariant(font);
      const key = fontVariantKey(font.family, variant);
      if (loadedVariants.has(key) || failedVariants.has(key) || loadingRef.current.has(key)) return;
      loadingRef.current.add(key);
      const face = new FontFace(font.family, `url(${JSON.stringify(font.url)}) format("${FONT_FORMATS[font.extension] || font.extension}")`, {
        weight: String(font.weight || 400),
        style: font.style === "italic" ? "italic" : "normal",
      });
      face.load().then((loaded) => {
        document.fonts.add(loaded);
        setLoadedVariants((current) => new Set(current).add(key));
      }).catch(() => {
        setFailedVariants((current) => new Set(current).add(key));
      }).finally(() => loadingRef.current.delete(key));
    });
  }, [failedVariants, fonts, loadedVariants]);

  const uploadFont = useCallback((values) => uploadEditorialFont({ projectId, user, ...values }), [projectId, user]);
  const availableFamilies = useMemo(() => new Set(fonts.filter((font) => loadedVariants.has(fontVariantKey(font.family, fontRecordVariant(font)))).map((font) => font.family)), [fonts, loadedVariants]);
  const pdfNonEmbeddableFonts = useMemo(() => new Set(fonts.filter((font) => !font.pdfEmbeddable).map((font) => font.family)), [fonts]);

  return {
    fonts,
    loadedVariants,
    failedVariants,
    availableFamilies,
    pdfNonEmbeddableFonts,
    buildOptions: (variant) => buildFontOptions(fonts, loadedVariants, variant, failedVariants),
    uploadFont,
    error,
  };
}
