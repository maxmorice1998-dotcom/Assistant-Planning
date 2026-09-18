"use strict";

// Modèle métier unique : AGATT est la source de vérité.
// Les cellules inconnues (par exemple TMJ) restent visibles dans le diagnostic
// mais ne deviennent ni un événement Google ni une indisponibilité Dendreo.
function normalizeCode(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (text === "G") return "G";
  if (text === "J") return "J";
  if (text === "N") return "N";
  if (text === "S") return "S";
  if (/^SHR(?:\s|$)/.test(text)) return text;
  return "";
}

function entryType(code) {
  const value = normalizeCode(code);
  if (["G", "J", "N"].includes(value)) return "GARDE";
  if (value === "S") return "STAGE";
  if (value.startsWith("SHR")) return "PRESENCE";
  return "AUTRE";
}

function nextDate(date) {
  const value = String(date || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  return String(value || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
}

function dendreoDates(entry, reposCompensatoire) {
  const slot = dendreoSlot(entry, reposCompensatoire);
  return slot ? slot.dates : [];
}

function dendreoSlot(entry, reposCompensatoire) {
  if (entry.type && entry.type !== "GARDE") return null;
  const shift = entry.shift?.kind || entry.shift;
  const date = entry.date;
  if (shift === "12h_nuit") {
    if (!reposCompensatoire) return null;
    const restDate = nextDate(date);
    return { date: restDate, dates: [restDate], startTime: "08:00", endTime: "20:00", kind: "REPOS COMPENSATOIRE" };
  }
  if (shift === "24h") {
    if (reposCompensatoire) return { date, dates: [date, nextDate(date)], startTime: "08:00", endTime: "08:00", kind: "GARDE 24H + REPOS" };
    return { date, dates: [date], startTime: "00:00", endTime: "00:00", kind: "GARDE 24H" };
  }
  return { date, dates: [date], startTime: "08:00", endTime: "20:00", kind: "GARDE 12H JOUR" };
}

function expectedDendreoSlots(guards, reposCompensatoire) {
  return (Array.isArray(guards) ? guards : []).map(guard => ({
    guard,
    slot: dendreoSlot(guard, reposCompensatoire),
  })).filter(item => item.slot);
}

function buildPlanning(items, reposCompensatoire) {
  const entries = (Array.isArray(items) ? items : [])
    .map(item => {
      const code = normalizeCode(item.code || item.text);
      const date = normalizeDate(item.date);
      return {
        ...item,
        code,
        date,
        type: entryType(code),
        google: Boolean(code),
      };
    })
    .filter(item => item.date && item.type !== "AUTRE")
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const guards = entries.filter(item => item.type === "GARDE");
  const compensatoryRestDates = reposCompensatoire
    ? guards.flatMap(item => {
        const shift = item.shift?.kind || item.shift;
        if (shift === "24h" || shift === "12h_nuit") return [nextDate(item.date)];
        return [];
      })
    : [];

  const dendreoById = new Map(expectedDendreoSlots(guards, reposCompensatoire).map(item => [item.guard.id, item.slot]));
  const finalEntries = entries.map(item => ({
    ...item,
    dendreoDates: dendreoById.get(item.id)?.dates || [],
  }));
  return {
    entries: finalEntries,
    google: finalEntries.filter(item => item.google),
    guards,
    dendreo: guards.map(item => ({
      ...item,
      dendreoDates: dendreoById.get(item.id)?.dates || [],
      dendreoSlot: dendreoById.get(item.id),
      type: "GARDE",
    })).filter(item => item.dendreoDates.length),
    compensatoryRestDates: [...new Set(compensatoryRestDates)].sort(),
    reposCompensatoire: reposCompensatoire === true,
  };
}

function printPlanning(planning) {
  console.log(`PLANNING SOURCE AGATT : ${planning.entries.length} jour(s) reconnus`);
  for (const item of planning.entries) {
    const dendreo = item.type === "GARDE" ? (item.dendreoSlot ? `${item.dendreoSlot.date} ${item.dendreoSlot.startTime}-${item.dendreoSlot.endTime}` : "AUCUNE") : "AUCUNE";
    console.log(`AGATT date=${item.date} type=${item.type}`);
    console.log(`ACTION DENDREO date=${dendreo === "AUCUNE" ? "AUCUNE" : dendreo} action=${dendreo === "AUCUNE" ? "AUCUNE" : "A DETERMINER"}`);
  }
  for (const item of planning.dendreo) {
    if (item.dendreoSlot.kind === "REPOS COMPENSATOIRE") {
      console.log(`ACTION DENDREO date=${item.dendreoSlot.date} action=REPOS COMPENSATOIRE 08:00-20:00 (garde AGATT ${item.date})`);
    }
  }
  if (planning.compensatoryRestDates.length) {
    console.log(`REPOS COMPENSATOIRE : ${planning.compensatoryRestDates.join(",")}`);
  } else {
    console.log("REPOS COMPENSATOIRE : aucun");
  }
}

module.exports = { normalizeCode, entryType, dendreoDates, dendreoSlot, expectedDendreoSlots, buildPlanning, printPlanning };
