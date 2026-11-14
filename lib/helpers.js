// ============================================================
//  lib/helpers.js — Funciones de formato y fechas compartidas
// ============================================================
'use strict';

const TZ = 'America/Mexico_City';

/** 'YYYY-MM-DD' de un Date en hora de México */
function ymd(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** dd/mm/YYYY desde string 'YYYY-MM-DD' o Date */
function fmtFecha(s) {
  if (!s) return '—';
  const str = typeof s === 'string' ? s.slice(0, 10) : ymd(new Date(s));
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

/** dd/mm/YYYY HH:MM desde datetime string 'YYYY-MM-DD HH:MM:SS' */
function fmtDT(s) {
  if (!s) return '—';
  // MySQL devuelve objetos Date; hay que pasarlos a hora local, no a UTC
  if (s instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    return `${p(s.getDate())}/${p(s.getMonth() + 1)}/${s.getFullYear()} ${p(s.getHours())}:${p(s.getMinutes())}`;
  }
  const str = String(s);
  return fmtFecha(str.slice(0, 10)) + ' ' + str.slice(11, 16);
}

/** 1,234.56 */
function money(n, dec = 2) {
  return parseFloat(n || 0).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtFolio(n) { return 'R-' + String(n).padStart(4, '0'); }

/** Hoy como 'YYYY-MM-DD' (hora de México) */
function hoy() { return ymd(); }

/** Suma días a 'YYYY-MM-DD' */
function addDays(ymdStr, n) {
  const d = new Date(ymdStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function manana() { return addDays(hoy(), 1); }

/** Diferencia en días entre dos 'YYYY-MM-DD' */
function diffDays(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

const MESES_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS_ES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/**
 * Filtros de periodo: Ayer, Hoy, Semana, Mes, 30 días, Rango.
 * Devuelve { periodo, desde, hasta, etiqueta }
 */
function rangoPeriodo(q = {}, forzarHoy = false) {
  const h = hoy();
  let periodo = forzarHoy ? 'hoy' : (q.periodo || 'hoy');
  let desde = h, hasta = h, etiqueta = 'Hoy';
  switch (periodo) {
    case 'ayer':   desde = hasta = addDays(h, -1); etiqueta = 'Ayer'; break;
    case 'semana': {
      const dow = new Date(h + 'T12:00:00Z').getUTCDay() || 7; // lunes=1
      desde = addDays(h, 1 - dow); hasta = h; etiqueta = 'Esta semana'; break;
    }
    case 'mes':    desde = h.slice(0, 8) + '01'; hasta = h; etiqueta = 'Este mes'; break;
    case '30':     desde = addDays(h, -29); hasta = h; etiqueta = 'Últimos 30 días'; break;
    case 'rango': {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      desde = re.test(q.desde || '') ? q.desde : h;
      hasta = re.test(q.hasta || '') ? q.hasta : h;
      if (hasta < desde) [desde, hasta] = [hasta, desde];
      etiqueta = fmtFecha(desde) + ' – ' + fmtFecha(hasta); break;
    }
    default: periodo = 'hoy';
  }
  return { periodo, desde, hasta, etiqueta, dias: diffDays(desde, hasta) + 1 };
}

/** Lista de fechas 'YYYY-MM-DD' entre desde y hasta (inclusive) */
function listaFechas(desde, hasta) {
  const out = [];
  for (let d = desde; d <= hasta && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Escapa texto para usar dentro de atributos/JS inline */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Teléfono a formato wa.me (México: agrega 52 si son 10 dígitos) */
function waNumber(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10) d = '52' + d;
  return d;
}

module.exports = {
  TZ, ymd, fmtFecha, fmtDT, money, fmtFolio, hoy, manana, addDays, diffDays,
  MESES_ES, DIAS_ES, rangoPeriodo, listaFechas, esc, waNumber,
};
