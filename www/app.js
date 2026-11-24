'use strict';
/* =============================================================
   Калькулятор каркасного дома — логика v2
   Смета из позиций справочника: автоподстановка количеств по
   правилам расчёта + ручное управление каждой позицией.
   ============================================================= */

/* ---------- Утилиты ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const fmtMoney = v => (v == null || isNaN(v)) ? '—' : nf0.format(Math.round(v)) + ' ₽';
const fmtMoneyShort = v => {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1e6) {
    let s = nf2.format(v / 1e6);
    if (s.includes(',')) s = s.replace(/0+$/, '').replace(/,$/, '');
    return s + ' млн ₽';
  }
  return nf0.format(Math.round(v)) + ' ₽';
};
const fmtQty = v => v == null ? '—' : (Math.abs(v - Math.round(v)) < 1e-9 ? nf0.format(v) : nf2.format(v));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => ('' + (s == null ? '' : s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, forms) => {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
};

/* ---------- Константы ---------- */
const STORE_KEY = 'kdc.v2';
const OLD_KEY = 'kdc.state.v1';
const PCT_IDS = new Set([139, 140, 142]); // позиции, считающиеся в % от базы
const SECTION_ICONS = {
  1: '📜', 2: '⛏️', 3: '🧱', 4: '📦', 5: '🧊', 6: '🏠', 7: '🎨', 8: '🪟',
  9: '🔨', 10: '⚡', 11: '🔥', 12: '💧', 13: '🌀', 14: '🏡', 15: '🚚', 16: '📊',
};
const PRICE_TYPE_LABELS = { min: 'Минимальная', base: 'Базовая', max: 'Максимальная' };
const DEFAULT_YANDEX_URL = 'https://disk.yandex.ru/i/f027lR2bCUJseA';

/* Параметры дома по умолчанию — база для правил автоподстановки количеств */
const DEFAULT_PARAMS = {
  area: 120, floors: 1, ceiling: 2.7, length: 0, width: 0,
  prep: { topo: true, geo: true, project: 'typical', engProject: true, clearing: false, trees: 0, trash: 2, temp: true },
  foundation: 'screw', screwDia: 108,
  found: { waterproof: true, xps: false, blind: true, drain: false },
  insulation: 'minvata', wallIns: 200,
  cover: 'metalTile', gutter: true, snow: true,
  facade: 'vinyl', paint: true,
  windowsArea: 25, entrance: true, terraceDoors: 0, interiorDoors: 5,
  electrics: 'full', gridConnect: true, heating: 'gas',
  well: true, treatment: true, waterIn: true, sewerIn: true, septic: true, bathrooms: 1,
  ventilation: 'recuperation',
  finishing: 'standard',
  extras: { terrace: 0, balcony: 0, carport: 0, porch: true, storm: 0, landscaping: true },
  logistics: { trips: 3, manipulator: 2, crane: 0, overheadPct: 5.5, supervision: false, supervisionPct: 1.5, cleanup: true, reservePct: 10 },
};

const STORE_AREA_MIN = 30, STORE_AREA_MAX = 400;

let state = {
  view: 'calc',          // calc | price | total | help
  section: 1,            // активный номер раздела
  area: 120,
  floors: 1,
  est: {},               // id -> { on, ptype, price, qty, manual, priceManual }
  dataset: null,
  priceSearch: '',
  priceSection: '',
  yandexUrl: DEFAULT_YANDEX_URL,
  justChanged: new Set(), // id позиций, цены которых изменились при последнем обновлении
  sums: null,            // кэш расчёта
};

/* ---------- Хранилище ---------- */
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      area: state.area, floors: state.floors, section: state.section,
      est: state.est, dataset: state.dataset, yandexUrl: state.yandexUrl,
    }));
  } catch (e) { /* хранилище недоступно — работаем в памяти */ }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.dataset && d.dataset.positions) state.dataset = d.dataset;
      if (d.est) state.est = d.est;
      if (d.area) state.area = clamp(+d.area || 120, STORE_AREA_MIN, STORE_AREA_MAX);
      if (d.floors) state.floors = +d.floors === 2 ? 2 : 1;
      if (d.section) state.section = +d.section || 1;
      if (d.yandexUrl) state.yandexUrl = String(d.yandexUrl);
      return;
    }
    // Миграция из версии 1: переносим загруженный прайс и площадь
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const d = JSON.parse(old);
      if (d.dataset && d.dataset.positions) state.dataset = d.dataset;
      if (d.params) {
        state.area = clamp(+d.params.area || 120, STORE_AREA_MIN, STORE_AREA_MAX);
        state.floors = +d.params.floors === 2 ? 2 : 1;
      }
    }
  } catch (e) { /* повреждённое состояние — начинаем с чистого листа */ }
}

function ensureDataset() {
  if (!state.dataset || !state.dataset.positions) {
    state.dataset = JSON.parse(JSON.stringify(window.DEFAULT_DATASET));
  }
}

/* ---------- Производные величины ---------- */
function deriveParams(area, floors) {
  floors = floors || 1;
  const footprint = area / floors;
  const ratio = 1.3;
  let W = Math.sqrt(footprint / ratio);
  let L = W * ratio;
  const perimeter = 2 * (L + W);
  const facadeArea = perimeter * 2.7 * floors;
  const roofArea = footprint * 1.45;
  const floorSlabs = footprint * floors;
  return {
    area, floors, footprint, L, W, perimeter,
    facadeArea, roofArea, floorSlabs,
    wallVol: facadeArea * 0.2,
    roofVol: roofArea * 0.2,
    floorVol: footprint * 0.2,
    piles: Math.ceil(perimeter / 2.5) + Math.ceil(footprint / 12),
    envelope: facadeArea + roofArea + footprint,
  };
}
function getP() { return { p: DEFAULT_PARAMS, d: deriveParams(state.area, state.floors) }; }

/* ---------- Правила автоподстановки количеств (по ID справочника) ---------- */
const Q = {
  1: P => P.p.prep.topo ? 1 : 0,
  2: P => P.p.prep.geo ? 1 : 0,
  3: P => P.p.prep.project === 'typical' ? 1 : 0,
  4: P => P.p.prep.project === 'individual' ? 1 : 0,
  5: P => P.p.prep.engProject ? 1 : 0,
  6: P => P.p.prep.clearing ? P.d.footprint : 0,
  7: P => +P.p.prep.trees || 0,
  8: P => +P.p.prep.trash || 0,
  9: P => P.p.prep.temp ? 1 : 0,
  10: P => P.p.prep.temp ? 1 : 0,
  11: P => P.p.prep.temp ? 3 : 0,

  12: () => 0,
  13: P => isSlab(P) ? P.d.footprint : 0,
  14: P => isSlab(P) ? P.d.footprint : 0,
  15: P => isSlab(P) ? P.d.footprint : 0,
  16: P => isSlab(P) ? P.d.footprint : 0,
  17: P => isSlab(P) ? Math.max(1, Math.ceil(P.d.footprint / 80)) : (isScrew(P) || isRc(P) ? 1 : 0),
  18: P => isSlab(P) ? 2 : 0,
  19: P => isScrew(P) && +P.p.screwDia === 89 ? P.d.piles : 0,
  20: P => isScrew(P) && +P.p.screwDia === 108 ? P.d.piles : 0,
  21: P => isScrew(P) && +P.p.screwDia === 133 ? P.d.piles : 0,
  22: P => isScrew(P) ? Math.round(P.d.perimeter * 1.15) : 0,
  23: P => isRc(P) && P.d.area < 110 ? 1 : 0,
  24: P => isRc(P) && P.d.area >= 110 ? 1 : 0,
  25: P => P.p.foundation === 'slab' ? P.d.footprint : 0,
  26: () => 0,
  27: P => P.p.foundation === 'uslp' ? P.d.footprint : 0,
  28: P => isSlab(P) && P.p.found.waterproof ? P.d.footprint : 0,
  29: P => (P.p.found.xps || P.p.foundation === 'uslp') ? P.d.footprint : 0,
  30: P => P.p.found.blind ? P.d.perimeter : 0,
  31: P => P.p.found.drain ? P.d.perimeter : 0,

  32: P => P.d.area * 0.11,
  33: P => (P.d.roofArea + P.d.facadeArea) * 0.015,
  34: P => P.p.cover === 'soft' ? Math.ceil(P.d.roofArea * 1.1 / 3.125) : 0,
  35: P => Math.ceil(P.d.facadeArea * 1.1 / 3.125),
  36: P => Math.ceil(P.d.floorSlabs * 1.1 / 3.125),
  37: () => 0,
  38: P => Math.max(1, Math.round(P.d.area / 120)),
  39: P => Math.max(1, Math.round(P.d.area / 120)),
  40: P => P.d.area,
  41: P => P.d.area * 0.8,
  42: P => P.d.facadeArea,
  43: P => P.d.floorSlabs,

  44: P => P.p.insulation === 'minvata' ? P.d.wallVol + P.d.roofVol : 0,
  45: P => P.p.insulation === 'minvata' ? P.d.floorVol : 0,
  46: P => P.p.insulation === 'ecovata' ? P.d.wallVol + P.d.roofVol + P.d.floorVol : 0,
  47: P => P.p.insulation === 'ecovata' ? 1 : 0,
  48: P => P.d.envelope * 1.1,
  49: P => P.d.facadeArea + P.d.roofArea,
  50: P => Math.ceil(P.d.envelope / 50),

  51: P => (P.p.wallIns === 150 || P.p.wallIns === 250) ? P.d.facadeArea : 0,
  52: P => P.p.wallIns === 150 ? P.d.facadeArea : 0,
  53: P => (P.p.wallIns >= 200 ? P.d.facadeArea : 0) + P.d.roofArea + P.d.footprint,
  54: P => P.d.envelope,
  55: P => P.d.facadeArea + P.d.roofArea,

  56: P => P.d.roofArea,
  57: P => P.d.roofArea,
  58: P => P.p.cover === 'profnastil' ? P.d.roofArea * 1.1 : 0,
  59: P => P.p.cover === 'metalTile' ? P.d.roofArea * 1.1 : 0,
  60: P => P.p.cover === 'soft' ? P.d.roofArea * 1.15 : 0,
  61: P => (P.p.cover === 'profnastil' || P.p.cover === 'metalTile') ? P.d.roofArea : 0,
  62: P => P.p.cover === 'soft' ? P.d.roofArea : 0,
  63: P => P.d.L * 3,
  64: P => P.d.perimeter,
  65: P => P.p.gutter ? P.d.L * 2 + 6 : 0,
  66: P => P.p.gutter ? P.d.L * 2 + 6 : 0,
  67: P => P.p.snow ? Math.ceil(P.d.L * 2 / 3) : 0,
  68: () => 0,
  69: () => 0,

  70: P => P.p.facade === 'vinyl' ? P.d.facadeArea : 0,
  71: P => P.p.facade === 'fiberCement' ? P.d.facadeArea : 0,
  72: P => P.p.facade === 'imitationBar' ? P.d.facadeArea : 0,
  73: P => P.p.facade === 'plaster' ? P.d.facadeArea : 0,
  74: P => P.p.facade === 'imitationBar' && P.p.paint ? P.d.facadeArea : 0,
  75: P => P.p.facade === 'imitationBar' && P.p.paint ? P.d.facadeArea : 0,
  76: () => 0,
  77: P => P.p.facade === 'imitationBar' ? P.d.perimeter * 1.5 : 0,

  78: P => P.p.windowsArea,
  79: P => P.p.windowsArea > 0 ? 1 : 0,
  80: P => P.p.entrance ? 1 : 0,
  81: P => +P.p.terraceDoors || 0,
  82: P => +P.p.interiorDoors || 0,
  83: () => 0,

  84: () => 0, 85: () => 0, 86: () => 0, 87: () => 0, 88: () => 0,
  89: () => 0, 90: () => 0, 91: () => 0, 92: () => 0, 93: () => 0, 94: () => 0,

  95: P => P.p.finishing === 'basic' ? P.d.area : 0,
  96: P => P.p.finishing === 'standard' ? P.d.area : 0,
  97: P => P.p.finishing === 'premium' ? P.d.area : 0,

  98: P => P.p.electrics !== 'none' ? 1 : 0,
  99: P => P.p.electrics !== 'none' ? Math.max(1, Math.round(P.d.area / 120)) : 0,
  100: P => P.p.electrics !== 'none' ? 1 : 0,
  101: P => P.p.electrics !== 'none' ? Math.max(1, Math.round(P.d.area / 120)) : 0,
  102: () => 0,
  103: P => P.p.gridConnect ? 1 : 0,

  104: P => P.p.heating === 'gas' ? 1 : 0,
  105: P => P.p.heating === 'gas' ? 1 : 0,
  106: P => P.p.heating === 'gas' ? 1 : 0,
  107: P => P.p.heating === 'gas' ? 1 : 0,
  108: P => P.p.heating === 'gas' ? 1 : 0,
  109: () => 0,
  110: P => P.p.heating === 'electric' ? 1 : 0,
  111: P => P.p.heating === 'electric' ? 1 : 0,
  112: P => P.p.heating === 'electric' ? 1 : 0,
  113: () => 0,
  114: P => P.p.heating === 'heatPump' ? 1 : 0,
  115: P => P.p.heating === 'heatPump' ? 1 : 0,
  116: P => P.p.heating === 'heatPump' ? 1 : 0,
  117: () => 0,

  118: P => P.p.well ? 1 : 0,
  119: P => P.p.well && P.p.treatment ? 1 : 0,
  120: P => P.p.waterIn ? 1 : 0,
  121: P => P.p.sewerIn ? 1 : 0,
  122: P => P.p.septic ? 1 : 0,
  123: P => +P.p.bathrooms || 0,
  124: () => 0,

  125: P => P.p.ventilation === 'natural' ? 1 : 0,
  126: P => P.p.ventilation === 'recuperation' ? 1 : 0,
  127: P => P.p.ventilation === 'recuperation' ? 1 : 0,
  128: P => P.p.ventilation === 'recuperation' ? 1 : 0,
  129: () => 0,

  130: P => +P.p.extras.terrace || 0,
  131: P => P.p.extras.porch ? 1 : 0,
  132: P => +P.p.extras.balcony || 0,
  133: P => +P.p.extras.carport || 0,
  134: P => +P.p.extras.storm || 0,
  135: P => P.p.extras.landscaping ? P.d.footprint * 1.5 : 0,

  136: P => +P.p.logistics.trips || 0,
  137: P => +P.p.logistics.manipulator || 0,
  138: P => +P.p.logistics.crane || 0,
  141: P => P.p.logistics.cleanup ? 1 : 0,
};
const isScrew = P => P.p.foundation === 'screw';
const isRc = P => P.p.foundation === 'rc';
const isSlab = P => P.p.foundation === 'slab' || P.p.foundation === 'uslp';

/* ---------- Состояние сметы ---------- */
function pickPrice(pos, type) {
  const v = type === 'min' ? pos.priceMin : type === 'max' ? pos.priceMax : pos.priceBase;
  if (v != null) return v;
  if (pos.priceBase != null) return pos.priceBase;
  if (pos.priceMin != null) return pos.priceMin;
  if (pos.priceMax != null) return pos.priceMax;
  return null;
}

/* Автоматическая раскладка сметы: какие позиции включены и с какими количествами */
function seedEstimate(keepToggles) {
  const P = getP();
  const old = keepToggles ? state.est : null;
  const est = {};
  for (const pos of state.dataset.positions) {
    const rule = Q[pos.id];
    let qty = rule ? rule(P) : 0;
    qty = Math.max(0, Math.round(qty * 100) / 100);
    const isInfo = /^16\./.test(pos.section);
    const e = {
      on: qty > 0 && !isInfo,
      ptype: 'base',
      price: pickPrice(pos, 'base'),
      qty,
      manual: false,
      priceManual: false,
    };
    if (pos.id === 139) { e.on = true; e.qty = DEFAULT_PARAMS.logistics.overheadPct; e.price = null; }
    if (pos.id === 140) { e.on = DEFAULT_PARAMS.logistics.supervision; e.qty = DEFAULT_PARAMS.logistics.supervisionPct; e.price = null; }
    if (pos.id === 142) { e.on = true; e.qty = DEFAULT_PARAMS.logistics.reservePct; e.price = null; }
    if (pos.id === 141) { e.on = DEFAULT_PARAMS.logistics.cleanup; e.qty = 1; }
    if (old && old[pos.id]) {
      const o = old[pos.id];
      e.on = !!o.on;
      if (o.manual) { e.qty = o.qty; e.manual = true; }
      if (o.priceManual) { e.price = o.price; e.priceManual = true; }
      if (o.ptype) e.ptype = o.ptype;
    }
    est[pos.id] = e;
  }
  state.est = est;
}

/* Обновить автоматические количества после изменения площади/этажности */
function applyAutoQuantities() {
  const P = getP();
  for (const pos of state.dataset.positions) {
    const e = state.est[pos.id];
    if (!e || PCT_IDS.has(pos.id) || e.manual) continue;
    const rule = Q[pos.id];
    e.qty = rule ? Math.max(0, Math.round(rule(P) * 100) / 100) : 0;
  }
}

function pctValue(id, base) {
  const e = state.est[id];
  return e && e.on && e.qty ? base * e.qty / 100 : 0;
}

/* Полный расчёт сумм */
function computeTotals() {
  const sectionSums = {};
  const byId = {};
  let subtotal = 0, missing = 0, count = 0;
  for (const pos of state.dataset.positions) {
    const e = state.est[pos.id];
    if (!e || !e.on || PCT_IDS.has(pos.id) || /^16\./.test(pos.section)) continue;
    count++;
    if (e.price == null) { byId[pos.id] = null; missing++; continue; }
    const sum = Math.round(e.qty * e.price * 100) / 100;
    byId[pos.id] = sum;
    subtotal += sum;
    const s = sectionSums[pos.section] = sectionSums[pos.section] || { sum: 0, has: false };
    s.sum += sum; s.has = true;
  }
  const overhead = pctValue(139, subtotal);
  const supervision = pctValue(140, subtotal);
  const reserve = pctValue(142, subtotal + overhead + supervision);
  const total = subtotal + overhead + supervision + reserve;
  const pctMap = { 139: overhead, 140: supervision, 142: reserve };
  for (const pos of state.dataset.positions) {
    if (!PCT_IDS.has(pos.id) || !state.est[pos.id] || !state.est[pos.id].on) continue;
    byId[pos.id] = pctMap[pos.id];
    const s = sectionSums[pos.section] = sectionSums[pos.section] || { sum: 0, has: false };
    s.sum += pctMap[pos.id]; s.has = true;
  }
  const perM2 = state.area ? total / state.area : 0;
  return { subtotal, overhead, supervision, reserve, total, perM2, sectionSums, byId, missing, count };
}

/* Ориентир по контрольным бюджетам (интерполяция по площади) */
function benchmarkFor(area) {
  const b = (state.dataset.benchmarks || []).slice().sort((x, y) => x.area - y.area);
  if (!b.length) return null;
  const perM2 = s => ({
    min: s.perM2Min != null ? s.perM2Min : (s.priceMin != null ? s.priceMin / s.area : null),
    max: s.perM2Max != null ? s.perM2Max : (s.priceMax != null ? s.priceMax / s.area : null),
  });
  const ok = q => q.min != null && q.max != null;
  if (area <= b[0].area) { const q = perM2(b[0]); if (!ok(q)) return null; return { min: q.min * area, max: q.max * area, scenario: b[0].scenario }; }
  if (area >= b[b.length - 1].area) { const q = perM2(b[b.length - 1]); if (!ok(q)) return null; return { min: q.min * area, max: q.max * area, scenario: b[b.length - 1].scenario }; }
  for (let i = 0; i < b.length - 1; i++) {
    if (area >= b[i].area && area <= b[i + 1].area) {
      const a = perM2(b[i]), c = perM2(b[i + 1]);
      if (!ok(a) || !ok(c)) return null;
      const k = (area - b[i].area) / (b[i + 1].area - b[i].area);
      return {
        min: (a.min + (c.min - a.min) * k) * area,
        max: (a.max + (c.max - a.max) * k) * area,
        scenario: area - b[i].area < b[i + 1].area - area ? b[i].scenario : b[i + 1].scenario,
      };
    }
  }
  return null;
}

/* ---------- Рендер ---------- */
function getSections() {
  const seen = new Map();
  for (const p of state.dataset.positions) {
    if (!seen.has(p.section)) seen.set(p.section, { name: p.section, num: parseInt(p.section, 10) || 0 });
  }
  return Array.from(seen.values()).sort((a, b) => a.num - b.num);
}

function renderSectionNav() {
  const t = state.sums;
  const nav = $('#sectionNav');
  nav.innerHTML = getSections().map(s => {
    const sum = t.sectionSums[s.name];
    const sumTxt = sum && sum.has && sum.sum > 0 ? fmtMoney(sum.sum) : '';
    return '<button class="sec-item' + (s.num === state.section ? ' active' : '') + '" data-sec="' + s.num + '">' +
      '<span class="sec-ic">' + (SECTION_ICONS[s.num] || '📋') + '</span>' +
      '<span class="sec-name">' + esc(s.name) + '</span>' +
      (sumTxt ? '<span class="sec-sum">' + sumTxt + '</span>' : '') +
      '</button>';
  }).join('');
}

function updateSumCell(id) {
  const el = document.querySelector('[data-psum="' + id + '"]');
  if (!el) return;
  const v = state.sums.byId[id];
  if (v == null) { el.textContent = '—'; el.classList.add('empty'); }
  else { el.textContent = nf0.format(Math.round(v)); el.classList.remove('empty'); }
}

function cardHTML(pos) {
  const e = state.est[pos.id] || { on: false, ptype: 'base', price: null, qty: 0 };
  const isInfo = /^16\./.test(pos.section);
  const iconRow = '<div class="pos-meta"><span>🏷️ ' + esc(pos.type || '—') + '</span>' +
    '<span>📐 ' + esc(pos.unit || '—') + '</span>' +
    '<span>📁 ' + esc(pos.subsection || '—') + '</span></div>';
  const src = pos.url || pos.basis || '';
  const srcRow = src ? '<div class="pos-src">' + esc(src) + '</div>' : '';

  if (isInfo) {
    const range = pos.priceMin != null
      ? nf0.format(pos.priceMin) + ' — ' + nf0.format(pos.priceMax) + ' ₽'
      : 'цены скрыты в примере';
    return '<div class="pos-card" data-pos="' + pos.id + '"><div class="pos-card-body">' +
      '<div class="pos-card-head"><div>' +
      '<div class="pos-title">' + esc(pos.name) + '<span class="badge gray">Справочно</span></div>' +
      iconRow + srcRow + '</div></div>' +
      '<div class="pos-controls" style="grid-template-columns:1fr">' +
      '<div class="pc-field"><label>Контрольный диапазон за м²</label>' +
      '<div class="pos-sum' + (pos.priceMin != null ? '' : ' empty') + '">' + range + '</div></div></div>' +
      '</div></div>';
  }

  const badge = pos.status === 'Обязательно' ? '<span class="badge">Обязательно</span>' : '';
  const isPct = PCT_IDS.has(pos.id);
  let controls = '';
  if (e.on) {
    const typeSel = isPct ? '' :
      '<div class="pc-field"><label>Тип цены</label><select class="pc-select" data-ptype="' + pos.id + '">' +
      Object.keys(PRICE_TYPE_LABELS).map(k =>
        '<option value="' + k + '"' + (e.ptype === k ? ' selected' : '') + '>' + PRICE_TYPE_LABELS[k] + '</option>').join('') +
      '</select></div>';
    const priceInp = isPct ? '' :
      '<div class="pc-field"><label>Цена за ед., ₽</label><input type="number" class="pc-input" data-pprice="' + pos.id + '" step="any" value="' + (e.price != null ? e.price : '') + '" placeholder="укажите цену"></div>';
    const qtyLabel = isPct ? '% от базы' : 'Кол-во';
    const qtyInp = '<div class="pc-field"><label>' + qtyLabel + '</label><input type="number" class="pc-input" data-pqty="' + pos.id + '" step="any" value="' + e.qty + '"></div>';
    const sumCell = '<div class="pc-field"><label>Итого, ₽</label><div class="pos-sum" data-psum="' + pos.id + '"></div></div>';
    controls = '<div class="pos-controls"' + (isPct ? ' style="grid-template-columns:1fr 1fr"' : '') + '>' +
      typeSel + priceInp + qtyInp + sumCell + '</div>';
  }
  const changedCls = (state.justChanged && state.justChanged.has(pos.id)) ? ' changed' : '';
  return '<div class="pos-card ' + (e.on ? 'on' : 'off') + changedCls + '" data-pos="' + pos.id + '">' +
    '<div class="pos-card-head"><div class="pos-card-body">' +
    '<div class="pos-title">' + esc(pos.name) + badge + '</div>' +
    iconRow + srcRow +
    '</div>' +
    '<div class="switch' + (e.on ? ' on' : '') + '" data-pton="' + pos.id + '" title="' + (e.on ? 'Исключить из сметы' : 'Включить в смету') + '">' +
    '<div class="switch-track"></div><div class="switch-knob"></div></div></div>' +
    controls +
    '</div>';
}

function renderCards() {
  const sec = getSections().find(s => s.num === state.section) || getSections()[0];
  state.section = sec.num;
  const positions = state.dataset.positions.filter(p => p.section === sec.name);
  const oblig = positions.filter(p => p.status === 'Обязательно').length;
  $('#sectionTitle').textContent = sec.name;
  $('#sectionSub').textContent = positions.length + ' ' + plural(positions.length, ['позиция', 'позиции', 'позиций']) +
    (oblig ? ' · ' + oblig + ' ' + plural(oblig, ['обязательная', 'обязательные', 'обязательных']) : '');
  const cards = $('#cardsContainer');
  cards.innerHTML = positions.map((p, i) => cardHTML(p, i)).join('');
  // значения «Итого»
  for (const p of positions) updateSumCell(p.id);
}

function renderFooter() {
  const t = state.sums;
  animateValue($('#totalValue'), t.total, fmtMoney);
  $('#perM2Value').innerHTML = state.area
    ? nf0.format(Math.round(t.perM2)) + ' <span class="unit">₽/м²</span>'
    : '—';
}

function renderStatusbar() {
  const priced = state.dataset.positions.filter(p => p.priceBase != null || p.priceMin != null || p.priceMax != null).length;
  $('#statusDot').classList.toggle('warn', priced === 0);
  $('#statusText').textContent = priced
    ? 'Данные загружены · ' + priced + ' ' + plural(priced, ['цена', 'цены', 'цен'])
    : 'Цены не заданы — загрузите прайс';
  const m = state.dataset.meta || {};
  $('#updatedAt').textContent = m.updatedAtISO
    ? 'Обновлено: ' + new Date(m.updatedAtISO).toLocaleString('ru-RU')
    : (m.loadedAt ? 'Обновлено: ' + m.loadedAt : '');
}

/* Полный цикл перерисовки после структурных изменений */
function renderAll() {
  applyAutoQuantities();
  state.sums = computeTotals();
  renderSectionNav();
  renderCards();
  renderFooter();
  renderStatusbar();
  if (state.view === 'total') buildTotalView();
}

/* Лёгкий пересчёт (после правки цены/количеств) */
function refreshSums() {
  state.sums = computeTotals();
  renderSectionNav();
  renderFooter();
  if (state.view === 'total') buildTotalView();
}

/* ---------- Виды ---------- */
function switchView(v) {
  state.view = v;
  $('#welcomeView').classList.toggle('hidden', v !== 'welcome');
  $('#calcView').classList.toggle('hidden', v !== 'calc');
  $('#priceView').classList.toggle('hidden', v !== 'price');
  $('#totalView').classList.toggle('hidden', v !== 'total');
  $('#helpView').classList.toggle('hidden', v !== 'help');
  $('#statusBackBtn').classList.toggle('hidden', v === 'calc' || v === 'welcome');
  $('#homeBtn').classList.toggle('hidden', v === 'welcome');
  $('#priceViewBtn').classList.toggle('active', v === 'price');
  $('#helpViewBtn').classList.toggle('active', v === 'help');
  $('#showTotalBtn').classList.toggle('active', v === 'total');
  if (v === 'price') renderPriceTable();
  if (v === 'help') renderHelp();
  if (v === 'total') { buildTotalView(); $('#totalView').scrollTop = 0; }
}

/* ---------- Вид «Итог» ---------- */
function buildTotalView() {
  const t = state.sums;
  $('#totalSub').textContent = 'Дом ' + state.area + ' м² · ' + state.floors + ' ' +
    plural(state.floors, ['этаж', 'этажа', 'этажей']) + ' · ' + t.count + ' ' +
    plural(t.count, ['позиция', 'позиции', 'позиций']) + ' в смете';

  const rows = getSections().filter(s => s.num <= 15).map(s => {
    const sum = t.sectionSums[s.name];
    const v = sum && sum.has ? sum.sum : 0;
    return '<button class="total-row" data-jump="' + s.num + '">' +
      '<span class="sec-ic">' + (SECTION_ICONS[s.num] || '📜') + '</span>' +
      '<span class="total-row-name">' + esc(s.name) + '</span>' +
      '<span class="total-row-sum">' + fmtMoney(v) + '</span></button>';
  }).join('');

  const bench = benchmarkFor(state.area);
  const benchHtml = bench ?
    '<div class="bd-title">Рыночная вилка</div>' +
    '<div class="bench-box"><div class="bench-labels"><span>' + fmtMoneyShort(bench.min) + '</span><span>' + fmtMoneyShort(bench.max) + '</span></div>' +
    '<div class="bench-bar"><div class="bench-marker" style="left:calc(' +
    (bench.max > bench.min ? clamp((t.total - bench.min) / (bench.max - bench.min), 0, 1) * 100 : 50).toFixed(1) + '% - 2px)"></div></div>' +
    '<div class="bench-note">Ориентир по контрольным бюджетам справочника (' + esc(bench.scenario) + '): зелёная черта — ваша оценка.</div></div>' : '';

  $('#totalContent').innerHTML =
    (t.missing ? '<div class="warn-box">Позиций без цены: ' + t.missing + '. Загрузите актуальный прайс кнопкой «Загрузить данные» или укажите цены на вкладке «Прайс».</div>' : '') +
    '<div class="total-rows">' + rows + '</div>' +
    '<div class="total-hero">' +
    '<div class="total-hero-label">Общая стоимость строительства</div>' +
    '<div class="total-hero-value">' + fmtMoney(t.total) + '</div>' +
    '<div class="total-hero-sub">' + nf0.format(Math.round(t.perM2)) + ' ₽/м² при площади ' + state.area + ' м²</div>' +
    '</div>' + benchHtml;

  $('#totalContent').querySelectorAll('[data-jump]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.section = +btn.dataset.jump;
      switchView('calc');
      renderSectionNav();
      renderCards();
    });
  });
}

/* ---------- Вид «Прайс» ---------- */
function renderPriceTable() {
  const q = state.priceSearch.trim().toLowerCase();
  const sec = state.priceSection;
  const positions = state.dataset.positions.filter(p =>
    (!sec || p.section === sec) &&
    (!q || (p.name + ' ' + p.subsection + ' ' + p.comment).toLowerCase().includes(q)));

  const priced = state.dataset.positions.filter(x => x.priceBase != null || x.priceMin != null || x.priceMax != null).length;
  $('#priceCounter').innerHTML = 'Цены указаны у <b>' + priced + '</b> из ' + state.dataset.positions.length + ' позиций';

  const sel = $('#priceSectionFilter');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">Все разделы</option>' +
      getSections().map(s => '<option value="' + esc(s.name) + '">' + esc(s.name) + '</option>').join('');
    sel.value = sec || '';
  }

  let html = '<table class="price-table"><thead><tr>' +
    '<th style="width:44px">ID</th><th>Наименование</th><th>Раздел</th><th>Ед.</th>' +
    '<th class="ta-r">Мин</th><th class="ta-r">Базовая</th><th class="ta-r">Макс</th></tr></thead><tbody>';
  for (const p of positions) {
    html += '<tr><td>' + p.id + '</td>' +
      '<td class="pos-name">' + esc(p.name) + (p.priceHidden ? ' <span class="price-cell missing">· в примере цена скрыта</span>' : '') + '</td>' +
      '<td class="pos-sec">' + esc(p.section) + '</td>' +
      '<td class="pos-unit">' + esc(p.unit) + '</td>' +
      priceCell(p, 'priceMin') + priceCell(p, 'priceBase') + priceCell(p, 'priceMax') + '</tr>';
  }
  html += '</tbody></table>';
  $('#priceTableWrap').innerHTML = html;

  $('#priceTableWrap').querySelectorAll('.price-cell').forEach(cell => {
    cell.addEventListener('click', () => startPriceEdit(cell));
  });
}

function priceCell(p, field) {
  const v = p[field];
  return '<td class="price-cell' + (v == null ? ' missing' : '') + '" data-edit="' + p.id + ':' + field + '">' +
    (v != null ? fmtMoney(v) : 'не указана') + '</td>';
}

function startPriceEdit(cell) {
  if (cell.querySelector('input')) return;
  const [idStr, field] = cell.dataset.edit.split(':');
  const id = +idStr;
  const pos = state.dataset.positions.find(x => x.id === id);
  if (!pos) return;
  const cur = pos[field];
  cell.innerHTML = '<input type="number" step="1" value="' + (cur != null ? cur : '') + '" placeholder="0">';
  const input = cell.querySelector('input');
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', outside, true);
    const raw = input.value.trim();
    pos[field] = raw === '' ? null : Math.round(parseFloat(raw) * 100) / 100;
    pos.priceHidden = false;
    // Обновить цену в смете, если пользователь не задавал её вручную
    const e = state.est[id];
    if (e && !e.priceManual) e.price = pickPrice(pos, e.ptype);
    persist();
    renderPriceTable();
    refreshSums();
    updateSumCell(id);
    if (state.view !== 'calc') renderFooter();
    toast('Цена обновлена: ' + pos.name, 'ok');
  };
  const cancel = () => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', outside, true);
    renderPriceTable();
  };
  const outside = ev => {
    if (!cell.contains(ev.target)) commit();
  };
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape') cancel();
  });
  input.addEventListener('blur', commit);
  document.addEventListener('pointerdown', outside, true);
}

/* ---------- Вид «Помощь» ---------- */
function renderHelp() {
  const ds = state.dataset;
  const src = (ds.sources || []).map(s =>
    '<div class="help-source"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a>' +
    '<span>' + esc(s.used || '') + (s.date ? ' · ' + esc(s.date) : '') + '</span></div>'
  ).join('');
  $('#helpWrap').innerHTML =
    '<div class="help-card"><h3>Как пользоваться</h3>' +
    '<p>Слева — разделы сметы (16 разделов справочника затрат). Внутри раздела — карточки позиций. Количество по каждой позиции подставляется автоматически из площади дома и правил расчёта (сваи — по шагу 2,5 м по периметру, утепление — по объёму, кровля — с запасом 10–15%).</p>' +
    '<ul>' +
    '<li>Переключатель на карточке включает или исключает позицию из сметы.</li>' +
    '<li>«Тип цены» — минимальная, базовая или максимальная цена из прайса; цену за единицу можно править вручную.</li>' +
    '<li>«Кол-во» можно изменить вручную — тогда при смене площади оно останется вашим (автоподстановка не тронет его).</li>' +
    '<li>Общая стоимость и цена за м² — внизу окна. Кнопка «Показать итог» открывает сводку по разделам.</li>' +
    '</ul></div>' +

    '<div class="help-card"><h3>Кнопки в шапке</h3>' +
    '<ul>' +
    '<li><b>Новый расчёт</b> — восстановить автоматическую смету для нового клиента (прайс сохраняется).</li>' +
    '<li><b>Обновить данные</b> — скачать свежий прайс с Яндекс.Диска (disk.yandex.ru/i/f027lR2bCUJseA), сверить позиции и цены, внести изменения. Изменённые позиции подсвечиваются, в сообщении — сколько цен изменилось. Требуется интернет.</li>' +
    '<li><b>Загрузить данные</b> — загрузить прайс вручную из Excel (.xlsx, .xlsm, .xls) или CSV: наименование, единица измерения, цены (мин/база/макс). Позиции сопоставляются по ID или названию; колонка со ссылками на источники тоже подхватывается.</li>' +
    '<li><b>Экспорт</b> — сохранить смету в Excel: лист «Смета» с количествами, ценами и итогами + лист «Прайс» целиком.</li>' +
    '<li><b>Пересчитать</b> (внизу) — заново подставить цены из прайса и автоматические количества, сохранив ваш состав сметы.</li>' +
    '</ul></div>' +

    '<div class="help-card"><h3>Важно знать</h3>' +
    '<ul>' +
    '<li>Раздел «16. Контрольная стоимость» — справочный: диапазоны цены за м² из справочника, в смету не включается.</li>' +
    '<li>«Рыночная вилка» в итоге — ориентир по контрольным бюджетам, интерполированный на вашу площадь.</li>' +
    '<li>Калькулятор даёт предварительную оценку и не заменяет детальную смету подрядчика.</li>' +
    '</ul></div>' +

    '<div class="help-card"><h3>Источники данных справочника</h3><div class="help-sources">' + src + '</div></div>';
}

/* =============================================================
   Загрузка данных из файла
   ============================================================= */
const ALIASES = {
  id: ['id', 'код', 'номер', 'no'],
  section: ['раздел', 'этап', 'категория'],
  subsection: ['подраздел', 'подэтап', 'подкатегория'],
  name: ['наименование позиции', 'наименование', 'позиция', 'название', 'наименование работ'],
  type: ['тип позиции', 'тип'],
  unit: ['единица измерения', 'единица', 'ед', 'ед изм'],
  min: ['минимальная цена', 'мин цена', 'минимальная', 'мин', 'цена от'],
  base: ['базовая цена', 'базовая', 'база', 'цена', 'стоимость'],
  max: ['максимальная цена', 'максимальная', 'макс', 'цена до'],
  scenario: ['сценарий', 'сценарии', 'вариант'],
  area: ['площадь дома', 'площадь'],
  url: ['url', 'ссылка', 'источник ссылка', 'ссылка на источник', 'источник'],
  status: ['статус'],
  basis: ['основание цены', 'основание'],
};

const norm = s => ('' + (s == null ? '' : s)).toLowerCase().replace(/[^a-zа-яё0-9]/gi, '').trim();

function parseMoney(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = ('' + v).replace(/\u00A0/g, ' ').trim();
  if (!s) return null;
  if (/скры/i.test(s)) return null;
  s = s.replace(/[^\d,.\-]/g, '');
  if (!s) return null;
  s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function mapColumns(headers) {
  const map = {};
  headers.forEach((hRaw, i) => {
    const h = norm(hRaw);
    if (!h) return;
    for (const key in ALIASES) {
      if (map[key] != null) continue;
      for (const alias of ALIASES[key]) {
        if (h === norm(alias)) { map[key] = i; return; }
      }
    }
  });
  headers.forEach((hRaw, i) => {
    const h = norm(hRaw);
    if (!h) return;
    for (const key in ALIASES) {
      if (map[key] != null) continue;
      for (const alias of ALIASES[key]) {
        const a = norm(alias);
        if (a && h.includes(a)) { map[key] = i; return; }
      }
    }
  });
  return map;
}

function importWorkbook(wb, fileName) {
  let posUpdated = 0, posAdded = 0, benchUpdated = 0, pricesSet = 0;
  const existingByName = new Map(state.dataset.positions.map(p => [norm(p.name), p]));
  const existingById = new Map(state.dataset.positions.map(p => [p.id, p]));

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    if (rows.length < 2) continue;

    let headerIdx = -1, map = null;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const m = mapColumns(rows[i]);
      const score = Object.keys(m).length;
      if (score >= 2 && m.name != null) { headerIdx = i; map = m; break; }
      if (score >= 3 && m.min != null) { headerIdx = i; map = m; break; }
      if (score >= 2 && (m.scenario != null || (m.min != null && m.max != null))) { headerIdx = i; map = m; break; }
    }
    if (headerIdx < 0) continue;

    const headers = rows[headerIdx];
    const isBench = map.scenario != null || (headers.some(h => /площадь/i.test('' + h)) && (map.min != null || map.base != null) && map.name == null);

    if (isBench) {
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.length) continue;
        const area = parseMoney(map.area != null ? r[map.area] : null);
        const min = parseMoney(map.min != null ? r[map.min] : null);
        const base = parseMoney(map.base != null ? r[map.base] : null);
        const max = parseMoney(map.max != null ? r[map.max] : null);
        if (area == null || (min == null && base == null && max == null)) continue;
        const scen = (map.scenario != null ? '' + (r[map.scenario] || '') : '') || 'Сценарий ' + (benchUpdated + 1);
        let b = (state.dataset.benchmarks = state.dataset.benchmarks || []).find(x => norm(x.scenario) === norm(scen));
        if (!b) { b = { scenario: scen, area, note: '', priceMin: null, priceBase: null, priceMax: null, perM2Min: null, perM2Max: null }; state.dataset.benchmarks.push(b); }
        b.area = area;
        if (min != null) b.priceMin = min;
        if (base != null) b.priceBase = base;
        if (max != null) b.priceMax = max;
        if (b.priceMin != null && b.area) b.perM2Min = b.priceMin / b.area;
        if (b.priceMax != null && b.area) b.perM2Max = b.priceMax / b.area;
        benchUpdated++;
      }
      continue;
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const name = ('' + (map.name != null ? r[map.name] : '')).trim();
      if (!name) continue;
      if (/скры/i.test(name)) continue;
      const idRaw = map.id != null ? parseMoney(r[map.id]) : null;
      const id = idRaw != null ? Math.round(idRaw) : null;
      const min = map.min != null ? parseMoney(r[map.min]) : null;
      const base = map.base != null ? parseMoney(r[map.base]) : null;
      const max = map.max != null ? parseMoney(r[map.max]) : null;

      let target = null;
      if (id != null && existingById.has(id)) target = existingById.get(id);
      else if (existingByName.has(norm(name))) target = existingByName.get(norm(name));

      if (!target) {
        const newId = id != null ? id : Math.max(1000, ...state.dataset.positions.map(x => x.id)) + 1;
        target = {
          id: newId, section: (map.section != null ? '' + (r[map.section] || '') : 'Прочее') || 'Прочее',
          subsection: map.subsection != null ? '' + (r[map.subsection] || '') : '',
          name, type: map.type != null ? '' + (r[map.type] || '') : '',
          unit: map.unit != null ? '' + (r[map.unit] || '') : 'шт.',
          priceMin: null, priceBase: null, priceMax: null, priceHidden: false,
          status: '', basis: '', url: '', comment: '',
        };
        state.dataset.positions.push(target);
        existingByName.set(norm(name), target);
        existingById.set(newId, target);
        posAdded++;
      } else {
        posUpdated++;
      }
      if (map.unit != null && r[map.unit]) target.unit = '' + r[map.unit];
      if (map.section != null && r[map.section]) target.section = '' + r[map.section];
      if (map.type != null && r[map.type]) target.type = '' + r[map.type];
      if (map.status != null && r[map.status]) target.status = '' + r[map.status];
      if (map.basis != null && r[map.basis]) target.basis = ('' + r[map.basis]).trim();
      if (map.url != null && r[map.url]) target.url = ('' + r[map.url]).trim();
      if (min != null) target.priceMin = min;
      if (base != null) target.priceBase = base;
      if (max != null) target.priceMax = max;
      if (min != null || base != null || max != null) { target.priceHidden = false; pricesSet++; }
    }
  }

  if (posUpdated || posAdded || benchUpdated) {
    state.dataset.meta = state.dataset.meta || {};
    state.dataset.meta.source = fileName;
    state.dataset.meta.loadedAt = new Date().toLocaleDateString('ru-RU');
    state.dataset.meta.updatedAtISO = new Date().toISOString();
    persist();
  }
  return { posUpdated, posAdded, benchUpdated, pricesSet };
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const res = importWorkbook(wb, file.name);
      if (!res.posUpdated && !res.posAdded && !res.benchUpdated) {
        toast('Не удалось распознать структуру таблицы. Проверьте заголовки колонок (наименование, цены).', 'error');
        return;
      }
      // Обновить цены и количества в смете, сохранив состав (вкл/выкл и ручные правки)
      seedEstimate(true);
      renderAll();
      if (state.view === 'welcome') switchView('calc');
      if (state.view === 'price') { $('#priceSectionFilter').innerHTML = ''; renderPriceTable(); }
      toast('Данные загружены: обновлено позиций — ' + res.posUpdated + ', добавлено — ' + res.posAdded + ', цен заполнено — ' + res.pricesSet +
        (res.benchUpdated ? ', сценариев — ' + res.benchUpdated : '') + '. Смета пересчитана.', 'ok');
    } catch (err) {
      toast('Ошибка чтения файла: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function downloadTemplate() {
  ensureDataset();
  const header = ['ID', 'Раздел', 'Подраздел', 'Наименование позиции', 'Тип позиции', 'Единица измерения', 'Минимальная цена, ₽', 'Базовая цена, ₽', 'Максимальная цена, ₽', 'Статус', 'Ссылка на источник', 'Комментарий'];
  const rows = [header];
  for (const p of state.dataset.positions) {
    rows.push([p.id, p.section, p.subsection, p.name, p.type, p.unit,
      p.priceMin != null ? p.priceMin : '', p.priceBase != null ? p.priceBase : '', p.priceMax != null ? p.priceMax : '',
      p.status || '', p.url || '', p.comment || '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 26 }, { wch: 22 }, { wch: 46 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 40 }, { wch: 36 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Прайс');
  XLSX.writeFile(wb, 'shablon_praysa.xlsx');
}

/* ---------- Обновление данных с Яндекс.Диска ---------- */
let cloudRefreshing = false;
async function refreshFromCloud() {
  if (cloudRefreshing) return;
  cloudRefreshing = true;
  const btns = [$('#refreshCloudBtn'), $('#refreshCloudBtn2')].filter(Boolean);
  const saved = btns.map(b => b.innerHTML);
  btns.forEach(b => { b.disabled = true; b.textContent = 'Обновление...'; });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const resp = await fetch('/api/yandex', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      const txt = (await resp.text()).replace(/^Yandex error:\s*/, '');
      throw new Error(txt || ('HTTP ' + resp.status));
    }
    const fnameHeader = resp.headers.get('x-yandex-file-name');
    const fname = fnameHeader ? decodeURIComponent(fnameHeader) : 'yandex.xlsx';
    const buf = new Uint8Array(await resp.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'array' });

    // Снимок цен до обновления — для подсветки изменений
    const before = {};
    for (const p of state.dataset.positions) {
      before[p.id] = [p.priceMin, p.priceBase, p.priceMax];
    }

    const res = importWorkbook(wb, fname);
    if (!res.posUpdated && !res.posAdded && !res.benchUpdated) {
      toast('Не удалось распознать структуру таблицы на Яндекс.Диске. Проверьте заголовки колонок.', 'error');
      return;
    }

    // Что изменилось
    const changed = [];
    for (const p of state.dataset.positions) {
      const b = before[p.id];
      if (!b) { changed.push(p.id); continue; }
      if (b[0] !== p.priceMin || b[1] !== p.priceBase || b[2] !== p.priceMax) changed.push(p.id);
    }

    seedEstimate(true);
    state.justChanged = new Set(changed);
    renderAll();
    persist();
    if (state.view === 'welcome') switchView('calc');
    setTimeout(() => {
      state.justChanged = new Set();
      if (state.view === 'calc') renderCards();
    }, 3200);

    toast('Данные с Яндекс.Диска обновлены (' + fname + '): позиций сверено — ' + res.posUpdated +
      ', изменилось цен — ' + changed.length +
      (res.posAdded ? ', добавлено позиций — ' + res.posAdded : '') +
      (changed.length ? '. Изменённые позиции подсвечены' : ''), changed.length ? 'ok' : undefined);
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'превышено время ожидания (60 секунд)'
      : err.message;
    toast('Не удалось обновить данные с Яндекс.Диска: ' + msg, 'error');
  } finally {
    cloudRefreshing = false;
    btns.forEach((b, i) => { b.disabled = false; b.innerHTML = saved[i]; });
  }
}

/* ---------- Экспорт в Excel ---------- */
function exportXlsx() {
  const t = state.sums;
  const rows = [];
  rows.push(['Смета каркасного дома']);
  rows.push(['Площадь дома, м²', state.area]);
  rows.push(['Этажность', state.floors]);
  rows.push(['Дата расчёта', new Date().toLocaleString('ru-RU')]);
  rows.push(['Источник данных', state.dataset.meta.source || '']);
  rows.push([]);
  rows.push(['Раздел', 'Позиция', 'Кол-во', 'Ед.', 'Тип цены', 'Цена за ед.', 'Итого, ₽']);
  const sections = getSections().filter(s => s.num <= 15);
  for (const s of sections) {
    let secSum = 0;
    const secRows = [];
    for (const pos of state.dataset.positions) {
      if (pos.section !== s.name) continue;
      const e = state.est[pos.id];
      if (!e || !e.on) continue;
      const sum = t.byId[pos.id];
      if (PCT_IDS.has(pos.id)) continue;
      secRows.push(['', pos.name, e.qty, pos.unit,
        PRICE_TYPE_LABELS[e.ptype] || '',
        e.price != null ? e.price : '', sum != null ? Math.round(sum * 100) / 100 : '']);
      if (sum != null) secSum += sum;
    }
    if (!secRows.length) continue;
    rows.push([s.name]);
    for (const r of secRows) rows.push(r);
    rows.push(['', 'Итого по разделу', '', '', '', '', Math.round(secSum * 100) / 100]);
  }
  rows.push([]);
  const L = DEFAULT_PARAMS.logistics;
  rows.push(['', 'Позиции сметы (разделы 1–15)', '', '', '', '', Math.round(t.subtotal * 100) / 100]);
  rows.push(['', 'Доставка и накладные расходы (' + L.overheadPct + '%)', '', '', '', '', Math.round(t.overhead * 100) / 100]);
  if (state.est[140] && state.est[140].on) rows.push(['', 'Технический надзор (' + L.supervisionPct + '%)', '', '', '', '', Math.round(t.supervision * 100) / 100]);
  rows.push(['', 'Резерв на непредвиденные расходы (' + L.reservePct + '%)', '', '', '', '', Math.round(t.reserve * 100) / 100]);
  rows.push(['', 'ИТОГО ПО ПРОЕКТУ', '', '', '', '', Math.round(t.total * 100) / 100]);
  rows.push(['', 'Цена за м²', '', '', '', '', Math.round(t.perM2 * 100) / 100]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 24 }, { wch: 48 }, { wch: 9 }, { wch: 12 }, { wch: 14 }, { wch: 13 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Смета');

  const priceRows = [['ID', 'Раздел', 'Подраздел', 'Наименование', 'Тип', 'Ед.', 'Мин', 'База', 'Макс', 'Ссылка', 'Комментарий']];
  for (const p of state.dataset.positions) {
    priceRows.push([p.id, p.section, p.subsection, p.name, p.type, p.unit,
      p.priceMin != null ? p.priceMin : '', p.priceBase != null ? p.priceBase : '', p.priceMax != null ? p.priceMax : '',
      p.url || '', p.comment || '']);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(priceRows);
  ws2['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 20 }, { wch: 46 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 34 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Прайс');

  XLSX.writeFile(wb, 'smeta_dom_' + state.area + 'm2.xlsx');
  toast('Смета сохранена в Excel: смета + прайс-лист', 'ok');
}

/* ---------- Экспорт CSV ---------- */
function exportCsv() {
  const t = state.sums;
  const lines = [];
  lines.push(['Смета каркасного дома', state.area + ' м²', state.floors + ' эт.']);
  lines.push(['Источник данных', state.dataset.meta.source || '']);
  lines.push([]);
  lines.push(['Раздел', 'Позиция', 'Кол-во', 'Ед.', 'Тип цены', 'Цена за ед.', 'Итого, ₽']);
  for (const s of getSections().filter(s => s.num <= 15)) {
    for (const pos of state.dataset.positions) {
      if (pos.section !== s.name) continue;
      const e = state.est[pos.id];
      if (!e || !e.on || PCT_IDS.has(pos.id)) continue;
      const sum = t.byId[pos.id];
      lines.push([s.name, pos.name, fmtQty(e.qty), pos.unit, PRICE_TYPE_LABELS[e.ptype] || '',
        e.price != null ? e.price : '', sum != null ? Math.round(sum) : '']);
    }
  }
  lines.push([]);
  lines.push(['', 'Позиции сметы (1–15)', '', '', '', '', Math.round(t.subtotal)]);
  lines.push(['', 'Накладные расходы', '', '', '', '', Math.round(t.overhead)]);
  if (state.est[140] && state.est[140].on) lines.push(['', 'Технический надзор', '', '', '', '', Math.round(t.supervision)]);
  lines.push(['', 'Резерв', '', '', '', '', Math.round(t.reserve)]);
  lines.push(['', 'ИТОГО', '', '', '', '', Math.round(t.total)]);
  lines.push(['', 'Цена за м²', '', '', '', '', Math.round(t.perM2)]);

  const csv = '\uFEFF' + lines.map(r => r.map(c => '"' + ('' + (c == null ? '' : c)).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'smeta_dom_' + state.area + 'm2.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Смета сохранена в CSV', 'ok');
}

/* ---------- Тосты ---------- */
function toast(text, type) {
  const host = $('#toastHost');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.innerHTML = '<span class="t-dot"></span><span>' + esc(text) + '</span>';
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 4200);
}

/* ---------- Анимация чисел ---------- */
let totalAnim = null, totalAnimT = null;
function animateValue(el, to, formatter) {
  const from = el._val || 0;
  if (totalAnim) cancelAnimationFrame(totalAnim);
  if (totalAnimT) clearTimeout(totalAnimT);
  const t0 = performance.now(), dur = 420;
  const finish = () => { el.textContent = formatter(to); el._val = to; };
  const tick = now => {
    const k = clamp((now - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = formatter(from + (to - from) * e);
    if (k < 1) { totalAnim = requestAnimationFrame(tick); }
    else { totalAnim = null; finish(); }
  };
  totalAnim = requestAnimationFrame(tick);
  totalAnimT = setTimeout(() => { totalAnim = null; finish(); }, dur + 120);
}

/* ---------- Волна на кнопках ---------- */
document.addEventListener('pointerdown', e => {
  const t = e.target.closest('.btn, .sec-item, .link-btn, .switch, .total-row');
  if (!t) return;
  const r = t.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 1.1;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = d + 'px';
  s.style.left = (e.clientX - r.left - d / 2) + 'px';
  s.style.top = (e.clientY - r.top - d / 2) + 'px';
  if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
  t.style.overflow = 'hidden';
  t.appendChild(s);
  setTimeout(() => s.remove(), 600);
});

/* ---------- Действия ---------- */
function doNewCalculation() {
  state.area = 120;
  state.floors = 1;
  $('#areaInput').value = 120;
  $('#floorsSelect').value = '1';
  seedEstimate(false);
  state.section = 1;
  switchView('calc');
  renderAll();
  persist();
  toast('Новый расчёт начат: смета собрана автоматически, прайс сохранён');
}

function doRecalculate() {
  seedEstimate(true);
  renderAll();
  persist();
  const t = state.sums;
  const priced = state.dataset.positions.filter(p => p.priceBase != null || p.priceMin != null || p.priceMax != null).length;
  toast(priced
    ? 'Смета пересчитана: ' + fmtMoney(t.total) + ' (' + nf0.format(Math.round(t.perM2)) + ' ₽/м²)'
    : 'Пересчёт выполнен: цены не заданы. Загрузите актуальный прайс.', priced ? undefined : 'warn');
}

/* ---------- Инициализация ---------- */
function init() {
  loadPersisted();
  ensureDataset();
  if (!state.est || !Object.keys(state.est).length) seedEstimate(false);

  $('#areaInput').value = state.area;
  $('#floorsSelect').value = String(state.floors);

  // Шапка
  $('#newCalcBtn').addEventListener('click', () => $('#confirmOverlay').classList.remove('hidden'));
  $('#confirmCancel').addEventListener('click', () => $('#confirmOverlay').classList.add('hidden'));
  $('#confirmOverlay').addEventListener('click', e => {
    if (e.target === $('#confirmOverlay')) $('#confirmOverlay').classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('#confirmOverlay').classList.add('hidden');
      if (state.view === 'total') switchView('calc');
    }
  });
  $('#confirmNew').addEventListener('click', () => {
    $('#confirmOverlay').classList.add('hidden');
    doNewCalculation();
  });

  $('#areaInput').addEventListener('change', () => {
    let v = clamp(parseFloat($('#areaInput').value) || 120, STORE_AREA_MIN, STORE_AREA_MAX);
    $('#areaInput').value = v;
    state.area = v;
    renderAll();
    persist();
  });
  $('#floorsSelect').addEventListener('change', () => {
    state.floors = +$('#floorsSelect').value;
    renderAll();
    persist();
  });

  $('#loadDataBtn').addEventListener('click', () => $('#fileInput').click());
  $('#loadDataBtn2').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', () => {
    handleFile($('#fileInput').files[0]);
    $('#fileInput').value = '';
  });
  $('#refreshCloudBtn').addEventListener('click', refreshFromCloud);
  $('#refreshCloudBtn2').addEventListener('click', refreshFromCloud);
  $('#exportBtnTop').addEventListener('click', exportXlsx);

  // Статус-строка
  $('#priceViewBtn').addEventListener('click', () => switchView(state.view === 'price' ? 'calc' : 'price'));
  $('#helpViewBtn').addEventListener('click', () => switchView(state.view === 'help' ? 'calc' : 'help'));
  $('#statusBackBtn').addEventListener('click', () => switchView('calc'));

  // Разделы
  $('#sectionNav').addEventListener('click', e => {
    const b = e.target.closest('.sec-item');
    if (!b) return;
    state.section = +b.dataset.sec;
    switchView('calc');
    renderSectionNav();
    renderCards();
    persist();
  });

  // Карточки позиций
  const cards = $('#cardsContainer');
  cards.addEventListener('click', e => {
    const sw = e.target.closest('[data-pton]');
    if (!sw) return;
    const id = +sw.dataset.pton;
    const en = state.est[id];
    en.on = !en.on;
    // Включили вручную позицию с нулевым количеством — ставим 1, чтобы строка имела смысл
    if (en.on && !en.manual && (en.qty == null || en.qty <= 0) && !PCT_IDS.has(id)) en.qty = 1;
    renderCards();
    refreshSums();
    persist();
  });
  cards.addEventListener('change', e => {
    const pt = e.target.closest('[data-ptype]');
    if (!pt) return;
    const id = +pt.dataset.ptype;
    const en = state.est[id];
    en.ptype = pt.value;
    en.price = pickPrice(state.dataset.positions.find(p => p.id === id), en.ptype);
    en.priceManual = false;
    renderCards();
    refreshSums();
    persist();
  });
  cards.addEventListener('input', e => {
    const pr = e.target.closest('[data-pprice]');
    if (pr) {
      const id = +pr.dataset.pprice;
      const en = state.est[id];
      en.price = pr.value.trim() === '' ? null : Math.round(parseFloat(pr.value) * 100) / 100;
      en.priceManual = pr.value.trim() !== '';
      updateSumCell(id);
      refreshSums();
      persist();
      return;
    }
    const qt = e.target.closest('[data-pqty]');
    if (qt) {
      const id = +qt.dataset.pqty;
      const en = state.est[id];
      en.qty = Math.max(0, parseFloat(qt.value) || 0);
      en.manual = true;
      updateSumCell(id);
      refreshSums();
      persist();
    }
  });

  // Футер
  $('#recalcBtn').addEventListener('click', doRecalculate);
  $('#showTotalBtn').addEventListener('click', () => switchView(state.view === 'total' ? 'calc' : 'total'));

  // Прайс
  $('#priceSearch').addEventListener('input', e => {
    state.priceSearch = e.target.value;
    renderPriceTable();
  });
  $('#priceSectionFilter').addEventListener('change', e => {
    state.priceSection = e.target.value;
    renderPriceTable();
  });
  $('#templateBtn').addEventListener('click', downloadTemplate);

  // Экран приветствия
  $('#startCalcBtn').addEventListener('click', () => switchView('calc'));
  $('#homeBtn').addEventListener('click', () => switchView('welcome'));
  $('#brandHome').addEventListener('click', () => switchView('welcome'));

  switchView('welcome');
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
