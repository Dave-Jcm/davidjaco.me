const MONTHS_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export function slugify(title) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "post";
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function displayDateFor(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS_ES[m - 1]} ${d} ${y}`;
}

export function sanitizeFilename(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const cleanBase = slugify(base);
  return ext ? `${cleanBase}.${ext.replace(/[^a-z0-9]/g, "")}` : cleanBase;
}
