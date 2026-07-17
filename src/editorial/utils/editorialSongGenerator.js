import { createAcademicBlock } from "./editorialAcademicGenerators.js";

const SECTION_PATTERN = /^\s*\[(verse|chorus|bridge|custom)(?:\s*:\s*([^\]]+))?\]\s*$/i;

export function parseSongSections(value = "") {
  const sections = [];
  let current = { type: "verse", title: "Verse 1", lines: [] };
  String(value).split(/\r?\n/).forEach((line) => {
    const marker = line.match(SECTION_PATTERN);
    if (marker) {
      if (current.lines.length) sections.push(current);
      const type = marker[1].toLowerCase();
      current = { type, title: marker[2] || type[0].toUpperCase() + type.slice(1), lines: [] };
    } else current.lines.push(line);
  });
  if (current.lines.length || sections.length === 0) sections.push(current);
  return sections.map((section) => ({ ...section, content: section.lines.join("\n").trim() }));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createSongSheet(input = {}, options = {}) {
  const sections = input.sections || parseSongSections(input.lyrics);
  const blankWords = Array.isArray(input.blankWords) ? input.blankWords : String(input.blankWords || "").split(/[,\n]/).map((word) => word.trim()).filter(Boolean);
  const replaceWords = (content) => blankWords.reduce((result, word) => result.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi"), "__________"), content);
  const elements = [];
  let y = Number(options.y ?? 52);
  const add = (items) => { items.forEach((item) => elements.push({ ...item, zIndex: elements.length })); };
  add(createAcademicBlock("activity_header", { x: 54, y, content: input.title || "Título de la canción" }).map((element) => ({ ...element, songSheet: true, academicBlockType: "song_header" })));
  y += 70;
  add(createAcademicBlock("instructions", { x: 64, y, content: `${input.artist ? `Artista: ${input.artist}` : ""}${input.level ? ` · Nivel: ${input.level}` : ""}` }).map((element) => ({ ...element, songSheet: true, academicBlockType: "song_metadata" })));
  y += 52;
  if (input.preActivity) { add(createAcademicBlock("instructions", { x: 64, y, content: input.preActivity }).map((element) => ({ ...element, name: "Actividad previa", songSheet: true }))); y += 60; }
  sections.forEach((section, index) => {
    const studentContent = `${section.title}\n${replaceWords(section.content)}`;
    const teacherContent = `${section.title}\n${section.content}`;
    add(createAcademicBlock("grammar_box", { x: 64, y, content: studentContent }).map((element) => ({
      ...element,
      songSheet: true,
      songSectionType: section.type,
      songSectionIndex: index,
      ...(element.academicRole === "content" && blankWords.length ? {
        studentContent,
        teacherContent,
        answerData: { type: "song_blanks", value: blankWords, acceptedValues: blankWords, explanation: "" },
      } : {}),
    })));
    y += 132;
  });
  if (blankWords.length && input.showWordBank !== false) { add(createAcademicBlock("word_bank", { x: 64, y, content: blankWords.join(" · ") }).map((element) => ({ ...element, songSheet: true }))); y += 130; }
  if (input.vocabulary) { add(createAcademicBlock("vocabulary_box", { x: 64, y, content: input.vocabulary }).map((element) => ({ ...element, songSheet: true }))); y += 130; }
  if (input.questions) { add(createAcademicBlock("comprehension", { x: 64, y, content: input.questions }).map((element) => ({ ...element, songSheet: true }))); y += 54; }
  if (input.postActivity) { add(createAcademicBlock("instructions", { x: 64, y, content: input.postActivity }).map((element) => ({ ...element, name: "Actividad posterior", songSheet: true }))); y += 60; }
  if (input.audioReference) add(createAcademicBlock("audio_reference", { x: 64, y, content: input.audioReference }).map((element) => ({ ...element, songSheet: true })));
  if (blankWords.length) add(createAcademicBlock("answers", { x: 64, y: y + 90, content: blankWords.join(" · ") }).map((element) => ({ ...element, songSheet: true })));
  return elements.map((element, index) => index === 0
    ? { ...element, songData: { ...input, sections, blankWords } }
    : element);
}
