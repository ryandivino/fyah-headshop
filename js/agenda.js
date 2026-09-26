const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQyjjUnsDuERjwna5fyMLAF2kKMDEVMDptSi5A9UIffWpguOernw5NPQklvfRZroifC-cD-d9FyuuF7/pub?output=csv";

const FALLBACK_EVENTS = [
  { dow: "SEX", day: "25", title: "Infesta: Baratinha", details: "Do pop ao techno — Thay, Zinnid, Leaja, Xennn, Joa1, Artur Veiga", time: "A partir das 20h" },
  { dow: "SÁB", day: "26", title: "Dancehall Style", details: "Roxedo e DJ KL", time: "A partir das 20h" }
];

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  }[c]));
}

// Parser de CSV.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ',') { row.push(field); field = ""; }
      else if (char === '\n' || char === '\r') {
        if (field !== "" || row.length) { row.push(field); rows.push(row); }
        row = []; field = "";
        if (char === '\r' && text[i + 1] === '\n') i++;
      } else field += char;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

function rowsToEvents(rows) {
  const [header, ...body] = rows;
  const cols = header.map(h => h.trim().toLowerCase());
  return body.map(r => {
    const obj = {};
    cols.forEach((c, idx) => { obj[c] = (r[idx] || "").trim(); });
    return obj;
  });
}

function renderEvents(events) {
  const container = document.getElementById("agenda-list");
  if (!events.length) {
    container.innerHTML = '<p class="empty">Nenhum evento marcado essa semana.</p>';
    return;
  }
  container.innerHTML = events.map(ev => `
    <div class="event">
      <div class="date"><span class="dow">${escapeHtml(ev.dow)}</span><span class="num">${escapeHtml(ev.day)}</span></div>
      <div class="info"><b>${escapeHtml(ev.title)}</b><span>${escapeHtml(ev.details)}</span></div>
      <div class="time">${escapeHtml(ev.time)}</div>
    </div>
  `).join("");
}

async function loadAgenda() {
  if (!SHEET_CSV_URL) {
    renderEvents(FALLBACK_EVENTS);
    return;
  }
  try {
    const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Falha ao buscar planilha: " + res.status);
    const text = await res.text();
    const events = rowsToEvents(parseCsv(text));
    renderEvents(events.length ? events : FALLBACK_EVENTS);
  } catch (err) {
    console.error("Não foi possível carregar a agenda da planilha, usando dados de exemplo.", err);
    renderEvents(FALLBACK_EVENTS);
  }
}

loadAgenda();