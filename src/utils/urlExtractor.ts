export function extractUrl(text: string): string {
  if (!text) return text;
  text = text.trim();

  // Markdown link/image with or without title: ![alt](url "title") or [text](url)
  const mdMatch = text.match(/^!?\[.*?\]\((.+?)(?:\s+["'].*?["'])?\)$/);
  if (mdMatch) return mdMatch[1].trim();

  // Obsidian link/image: ![[url]] or [[url|text]]
  const obsMatch = text.match(/^!?\[\[(.*?)(?:\|.*?)?\]\]$/);
  if (obsMatch) return obsMatch[1].trim();

  return text;
}

export function extractImplicitPoster(content: string): string | undefined {
  const lines = content.split("\n").map(l => l.trim());
  for (const line of lines) {
    if (line.indexOf(":") === -1) {
      const isMdImage = /^!\[.*?\]\((.+?)(?:\s+["'].*?["'])?\)$/.test(line);
      const isObsImage = /^!\[\[(.*?)(?:\|.*?)?\]\]$/.test(line);
      if (isMdImage || isObsImage) {
        return extractUrl(line);
      }
    }
  }
  return undefined;
}
