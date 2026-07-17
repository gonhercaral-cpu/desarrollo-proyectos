function toRoman(value) {
  if (!Number.isFinite(value) || value < 1) return "";
  const symbols = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = Math.floor(value);
  let result = "";
  symbols.forEach(([amount, symbol]) => {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  });
  return result;
}

export function formatEditorialPageNumber(value, style) {
  if (style === "none" || !value) return "";
  if (style === "roman_lower") return toRoman(value).toLowerCase();
  if (style === "roman_upper") return toRoman(value);
  return String(value);
}

export function calculateEditorialNumbering(pages, sections) {
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const sectionStates = new Map();
  const seenSections = new Set();
  const result = new Map();
  let lastNumber = 0;

  let physicalOrdinal = 0;
  pages.forEach((page) => {
    const section = sectionMap.get(page.sectionId) || {
      id: "__unsectioned__",
      numberingStyle: "arabic",
      numberingMode: "continue",
      numberingStart: 1,
    };
    const style = section.numberingStyle || "arabic";
    if (!seenSections.has(section.id)) {
      seenSections.add(section.id);
      if (section.startOnRight && (physicalOrdinal + 1) % 2 === 0) physicalOrdinal += 1;
    }
    physicalOrdinal += 1;
    const visible = page.numberingEnabled !== false && style !== "none" && !["cover", "back_cover"].includes(page.pageType);
    let state = sectionStates.get(section.id);

    if (!state) {
      const start = section.numberingMode === "restart"
        ? Math.max(1, Number(section.numberingStart || 1))
        : Math.max(1, lastNumber + 1);
      state = { next: start };
      sectionStates.set(section.id, state);
    }

    const value = visible ? state.next : null;
    if (visible) {
      state.next += 1;
      lastNumber = value;
    }

    result.set(page.id, {
      ordinal: physicalOrdinal,
      side: physicalOrdinal % 2 === 0 ? "left" : "right",
      value,
      label: formatEditorialPageNumber(value, style),
      style,
    });
  });

  return result;
}
