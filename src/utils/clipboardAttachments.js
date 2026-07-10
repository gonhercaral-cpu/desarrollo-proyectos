export function getPastedImageFiles(event) {
  const items = Array.from(event.clipboardData?.items || []);
  return items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      if (file.name && file.name !== "image.png") return file;
      const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return new File([file], `imagen-pegada-${Date.now()}-${index + 1}.${extension}`, {
        type: file.type,
        lastModified: file.lastModified,
      });
    })
    .filter(Boolean);
}
