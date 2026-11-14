// ============================================================
//  lib/settings.js — Configuración editable desde el sistema
//  (tabla CONFIGURACION clave/valor, con caché de 30 s)
// ============================================================
'use strict';

const { dbQuery, dbExecute } = require('./db');

const DEFAULTS = {
  negocio_nombre:       'Estacionamiento',
  negocio_direccion:    '',
  negocio_telefono:     '',
  negocio_horario:      '',
  capacidad:            '50',    // cajones disponibles
  tarifa_hora:          '25',    // misma tarifa para todos: la hora completa y después sube por minuto
  tolerancia_min:       '5',     // minutos de cortesía: si sale antes, no paga
  pension_aviso_dias:   '5',     // con cuántos días de anticipación se avisa que una pensión va a vencer
  cargo_boleto_perdido: '100',   // se suma al tiempo cuando el cliente no trae su ticket
  ticket_leyenda:       'Conserve este ticket, es indispensable para retirar su vehículo. No nos hacemos responsables por objetos dejados en el interior.',
};

let cache = null, cacheAt = 0;

async function getAll(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30000) return cache;
  const out = { ...DEFAULTS };
  try {
    const rows = await dbQuery('SELECT clave, valor FROM CONFIGURACION');
    rows.forEach(r => { out[r.clave] = r.valor ?? ''; });
  } catch { /* tabla aún no existe */ }
  cache = out; cacheAt = Date.now();
  return out;
}

async function set(values) {
  for (const [k, v] of Object.entries(values)) {
    await dbExecute(
      'INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [k, v == null ? '' : String(v)]
    );
  }
  cache = null;
}

module.exports = { DEFAULTS, getAll, set };
