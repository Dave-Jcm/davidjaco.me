// Minimal, deliberately non-general parser: our posts only ever use flat
// string/boolean/date fields, so a full YAML library isn't needed.

export function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const [, fm, body] = match;
  const data = {};
  for (const line of fm.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
    data[key] = value;
  }
  return { data, body: body.replace(/^\n/, "") };
}

export function stringifyFrontmatter(data, body) {
  const lines = Object.entries(data).map(([key, value]) => {
    if (typeof value === "boolean") return `${key}: ${value}`;
    // Dates stay unquoted so Eleventy/js-yaml parses them as real Date
    // objects — required for the posts collection's date sort to work.
    if (key === "date") return `${key}: ${value}`;
    return `${key}: "${String(value).replace(/"/g, '\\"')}"`;
  });
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}
