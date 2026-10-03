// Genera dist/stats.svg con datos reales de GitHub (lo corre la acción de animaciones).
// Uso: GH_TOKEN=... node .github/scripts/stats.mjs [usuario] [salida]
// Sin dependencias: usa fetch de Node 20 y las fuentes incrustadas de fonts.css.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const USER = process.argv[2] || process.env.GITHUB_REPOSITORY_OWNER || "jpinchi";
const OUT = process.argv[3] || "dist/stats.svg";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("Falta GH_TOKEN");

// Datos que no salen de la API (se actualizan a mano)
const STATIC = { apps: 5, tests: 140 };
const NOTY_REPO = "noty-releases";

const gh = async (url, body) => {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "stats-card", Accept: "application/vnd.github+json" },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
};

const q = `query($login: String!) { user(login: $login) {
  repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
    totalCount
    nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
  }
  contributionsCollection {
    totalCommitContributions restrictedContributionsCount
    contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
  }
} }`;
const { data, errors } = await gh("https://api.github.com/graphql", { query: q, variables: { login: USER } });
if (errors) throw new Error(JSON.stringify(errors));
const u = data.user;
const cal = u.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays);

// Rachas: la actual cuenta hacia atrás desde hoy (o desde ayer si hoy aún no hay nada)
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue;
  else break;
}
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
const active = days.filter((d) => d.contributionCount > 0).length;
const weekly = cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));

// Lenguajes de los repos públicos, por tamaño
const langs = {};
let stars = 0;
for (const r of u.repositories.nodes) {
  stars += r.stargazerCount;
  for (const e of r.languages.edges) {
    langs[e.node.name] ??= { size: 0, color: e.node.color || "#8f89b8" };
    langs[e.node.name].size += e.size;
  }
}
const legible = (hex) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (0.2126 * r + 0.7152 * g + 0.0722 * b > 70) return hex;
  const mix = (c) => Math.round(c + (255 - c) * 0.45).toString(16).padStart(2, "0");
  return "#" + mix(r) + mix(g) + mix(b);
};
const totalLang = Object.values(langs).reduce((s, l) => s + l.size, 0) || 1;
const top = Object.entries(langs).sort((a, b) => b[1].size - a[1].size).slice(0, 5)
  .map(([name, l]) => ({ name, color: legible(l.color), pct: (l.size / totalLang) * 100 }));
const otherPct = Math.max(0, 100 - top.reduce((s, l) => s + l.pct, 0));

// Noty: versión y descargas totales
let noty = { tag: "", downloads: 0 };
try {
  const rel = await gh(`https://api.github.com/repos/${USER}/${NOTY_REPO}/releases?per_page=100`);
  noty = { tag: rel[0]?.tag_name ?? "", downloads: rel.reduce((s, r) => s + r.assets.reduce((a, x) => a + x.download_count, 0), 0) };
} catch { /* si falla, se omite */ }

// ---------- Dibujo ----------
const fonts = fs.readFileSync(path.join(here, "fonts.css"), "utf8");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (n) => n.toLocaleString("es-ES");
const W = 1200, H = 440;

const kpis = [
  ["Contribuciones", fmt(cal.totalContributions), "en el último año"],
  ["Racha actual", fmt(current), current === 1 ? "día seguido" : "días seguidos"],
  ["Racha más larga", fmt(longest), "días en el último año"],
  ["Días activos", fmt(active), "con al menos una contribución"],
];
const kpiSvg = kpis.map(([label, value, sub], i) => {
  const x = 32 + i * 284;
  return `<g class="up" style="animation-delay:${0.1 + i * 0.12}s">
    <rect x="${x}" y="28" width="268" height="118" rx="18" fill="#151230" stroke="#2a2550"/>
    <text class="txt" x="${x + 22}" y="60" font-size="15" fill="#a59fc9">${label}</text>
    <text class="display" x="${x + 20}" y="112" font-size="48" fill="${i === 0 ? "url(#g)" : "#eeeaff"}" letter-spacing="-1">${value}</text>
    <text class="txt" x="${x + 22}" y="134" font-size="13" fill="#7c76a8">${sub}</text></g>`;
}).join("");

// Actividad semanal (52-53 barras)
const maxW = Math.max(1, ...weekly);
const bx = 32, bw = 700, bTop = 196, bH = 120, gap = 3;
const barW = (bw - gap * (weekly.length - 1)) / weekly.length;
const bars = weekly.map((v, i) => {
  const h = v ? Math.max(4, (v / maxW) * bH) : 2;
  return `<rect class="bar" style="animation-delay:${(0.4 + i * 0.012).toFixed(3)}s" x="${(bx + i * (barW + gap)).toFixed(1)}" y="${(bTop + bH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${v ? "url(#gv)" : "#221d44"}"/>`;
}).join("");

// Lenguajes
let lx = 32;
const segs = [...top, ...(otherPct > 0.5 ? [{ name: "Otros", color: "#4a4478", pct: otherPct }] : [])];
const langBar = segs.map((l, i) => {
  const w = (l.pct / 100) * 700;
  const s = `<rect class="seg" style="animation-delay:${(0.9 + i * 0.1).toFixed(2)}s" x="${lx.toFixed(1)}" y="358" width="${Math.max(w - 2, 1).toFixed(1)}" height="12" rx="3" fill="${l.color}"/>`;
  lx += w;
  return s;
}).join("");
const legend = segs.map((l, i) => {
  const x = 32 + (i % 3) * 236, y = 398 + Math.floor(i / 3) * 24;
  return `<circle cx="${x + 5}" cy="${y - 5}" r="5" fill="${l.color}"/><text class="txt" x="${x + 16}" y="${y}" font-size="14" fill="#c9c4ea">${esc(l.name)} <tspan fill="#7c76a8">${l.pct.toFixed(1)}%</tspan></text>`;
}).join("");

// Destacados (columna derecha)
const facts = [
  ["Apps publicadas", fmt(STATIC.apps)],
  ["Pruebas automatizadas", fmt(STATIC.tests)],
  ...(noty.tag ? [["Noty", noty.tag], ["Descargas de Noty", fmt(noty.downloads)]] : []),
  ["Repos públicos", fmt(u.repositories.totalCount)],
  ["Commits públicos (año)", fmt(u.contributionsCollection.totalCommitContributions)],
];
const factsSvg = facts.map(([k, v], i) => {
  const y = 214 + i * 36;
  return `<g class="up" style="animation-delay:${(0.6 + i * 0.08).toFixed(2)}s"><text class="txt" x="790" y="${y}" font-size="15" fill="#a59fc9">${k}</text>
    <text class="mono" x="1146" y="${y}" font-size="16" text-anchor="end" fill="#eeeaff">${esc(v)}</text>
    <path d="M790 ${y + 13} H1146" stroke="#221d44"/></g>`;
}).join("");

const updated = new Date().toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
  <title id="t">Estadísticas de GitHub de ${esc(USER)}</title>
  <desc id="d">${fmt(cal.totalContributions)} contribuciones en el último año, racha actual de ${current} días, racha más larga de ${longest} días y ${active} días activos. Lenguajes: ${segs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", ")}.</desc>
  <style>
    ${fonts}
    .display { font-family: PfDisplay, "Segoe UI", sans-serif; font-weight: 700; }
    .txt { font-family: PfText, "Segoe UI", sans-serif; font-weight: 500; }
    .mono { font-family: PfMono, Consolas, monospace; font-weight: 500; }
    .up { opacity: 0; animation: up .7s cubic-bezier(.2,.8,.2,1) forwards; }
    @keyframes up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    .bar { transform-box: fill-box; transform-origin: bottom; transform: scaleY(0); animation: bar .8s cubic-bezier(.2,.8,.2,1) forwards; }
    @keyframes bar { to { transform: scaleY(1); } }
    .seg { transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: seg .9s cubic-bezier(.2,.8,.2,1) forwards; }
    @keyframes seg { to { transform: scaleX(1); } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } .up { opacity: 1; } .bar, .seg { transform: none; } }
  </style>
  <defs>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="22"/></clipPath>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#A78BFA"/><stop offset=".5" stop-color="#E040FB"/><stop offset="1" stop-color="#FF8A00"/></linearGradient>
    <linearGradient id="gv" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#7F5AF0"/><stop offset=".6" stop-color="#E040FB"/><stop offset="1" stop-color="#FF8A00"/></linearGradient>
    <radialGradient id="glow" cx="1100" cy="0" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#E040FB" stop-opacity=".14"/><stop offset="1" stop-color="#E040FB" stop-opacity="0"/></radialGradient>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="#0d0b1e"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    ${kpiSvg}
    <text class="txt" x="32" y="182" font-size="15" fill="#a59fc9">Actividad semanal · último año</text>
    ${bars}
    <path d="M32 ${bTop + bH + 1} H732" stroke="#2a2550"/>
    <text class="txt" x="32" y="346" font-size="15" fill="#a59fc9">Lenguajes de mis repos públicos</text>
    ${langBar}
    ${legend}
    <rect x="766" y="166" width="402" height="250" rx="18" fill="#110f27" stroke="#2a2550"/>
    <text class="txt" x="790" y="190" font-size="12.5" fill="#7c76a8" letter-spacing="2">DESTACADOS</text>
    ${factsSvg}
    <text class="txt" x="1146" y="190" font-size="12" text-anchor="end" fill="#4a4478">Actualizado ${esc(updated)}</text>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="21.5" fill="none" stroke="#2a2550"/>
</svg>
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg);

// ---------- Versión para celular (600 de ancho; en pantalla queda a ~51 %) ----------
const MW = 600;
const mKpis = kpis.map(([label, value, sub], i) => {
  const x = 24 + (i % 2) * 288, y = 24 + Math.floor(i / 2) * 166;
  return `<g class="up" style="animation-delay:${0.1 + i * 0.12}s">
    <rect x="${x}" y="${y}" width="264" height="150" rx="20" fill="#151230" stroke="#2a2550"/>
    <text class="txt" x="${x + 22}" y="${y + 38}" font-size="22" fill="#a59fc9">${label}</text>
    <text class="display" x="${x + 20}" y="${y + 104}" font-size="62" fill="${i === 0 ? "url(#g)" : "#eeeaff"}" letter-spacing="-1">${value}</text>
    <text class="txt" x="${x + 22}" y="${y + 133}" font-size="18" fill="#7c76a8">${sub.replace("con al menos una contribución", "con contribuciones")}</text></g>`;
}).join("");
const mbTop = 404, mbH = 130, mbx = 24, mbw = 552, mgap = 3;
const mBarW = (mbw - mgap * (weekly.length - 1)) / weekly.length;
const mBars = weekly.map((v, i) => {
  const h = v ? Math.max(5, (v / maxW) * mbH) : 3;
  return `<rect class="bar" style="animation-delay:${(0.4 + i * 0.012).toFixed(3)}s" x="${(mbx + i * (mBarW + mgap)).toFixed(1)}" y="${(mbTop + mbH - h).toFixed(1)}" width="${mBarW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${v ? "url(#gv)" : "#221d44"}"/>`;
}).join("");
let mlx = 24;
const mLangBar = segs.map((l, i) => {
  const w = (l.pct / 100) * 552;
  const s = `<rect class="seg" style="animation-delay:${(0.9 + i * 0.1).toFixed(2)}s" x="${mlx.toFixed(1)}" y="602" width="${Math.max(w - 2, 1).toFixed(1)}" height="16" rx="4" fill="${l.color}"/>`;
  mlx += w;
  return s;
}).join("");
const mLegend = segs.map((l, i) => {
  const x = 24 + (i % 2) * 288, y = 662 + Math.floor(i / 2) * 36;
  return `<circle cx="${x + 7}" cy="${y - 7}" r="7" fill="${l.color}"/><text class="txt" x="${x + 24}" y="${y}" font-size="21" fill="#c9c4ea">${esc(l.name)} <tspan fill="#7c76a8">${l.pct.toFixed(1)}%</tspan></text>`;
}).join("");
const legendRows = Math.ceil(segs.length / 2);
const fTop = 662 + legendRows * 36 + 10;
const mFacts = facts.map(([k, v], i) => {
  const y = fTop + 84 + i * 50;
  return `<g class="up" style="animation-delay:${(0.6 + i * 0.08).toFixed(2)}s"><text class="txt" x="48" y="${y}" font-size="22" fill="#a59fc9">${k}</text>
    <text class="mono" x="552" y="${y}" font-size="24" text-anchor="end" fill="#eeeaff">${esc(v)}</text>
    <path d="M48 ${y + 18} H552" stroke="#221d44"/></g>`;
}).join("");
const MH = fTop + 84 + facts.length * 50 + 24;
const svgM = svg
  .replace(`viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"`, `viewBox="0 0 ${MW} ${MH}" width="${MW}" height="${MH}"`)
  .replace(/<clipPath id="frame">.*?<\/clipPath>/, `<clipPath id="frame"><rect width="${MW}" height="${MH}" rx="26"/></clipPath>`)
  .replace(/cx="1100" cy="0" r="520"/, `cx="${MW}" cy="0" r="460"`)
  .replace(/<g clip-path="url\(#frame\)">[\s\S]*<\/svg>\s*$/, `<g clip-path="url(#frame)">
    <rect width="${MW}" height="${MH}" fill="#0d0b1e"/>
    <rect width="${MW}" height="${MH}" fill="url(#glow)"/>
    ${mKpis}
    <text class="txt" x="24" y="384" font-size="22" fill="#a59fc9">Actividad semanal · último año</text>
    ${mBars}
    <path d="M24 ${mbTop + mbH + 1} H576" stroke="#2a2550"/>
    <text class="txt" x="24" y="584" font-size="22" fill="#a59fc9">Lenguajes de mis repos públicos</text>
    ${mLangBar}
    ${mLegend}
    <rect x="24" y="${fTop}" width="552" height="${MH - fTop - 24}" rx="20" fill="#110f27" stroke="#2a2550"/>
    <text class="txt" x="48" y="${fTop + 42}" font-size="18" fill="#7c76a8" letter-spacing="2.5">DESTACADOS</text>
    <text class="txt" x="552" y="${fTop + 42}" font-size="17" text-anchor="end" fill="#4a4478">Actualizado ${esc(updated)}</text>
    ${mFacts}
  </g>
  <rect x=".5" y=".5" width="${MW - 1}" height="${MH - 1}" rx="25.5" fill="none" stroke="#2a2550"/>
</svg>
`);
const OUT_M = OUT.replace(/\.svg$/, "-mobile.svg");
fs.writeFileSync(OUT_M, svgM);
console.log(`${path.basename(OUT_M)}: ${MW}×${MH}`);
console.log(`stats.svg: ${cal.totalContributions} contribuciones, racha ${current}/${longest}, ${active} días activos, ${segs.length} lenguajes, Noty ${noty.tag} ${noty.downloads}`);
