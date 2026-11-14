// ── Historial de vehículos (administrador) ─────────────────────
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const router  = express.Router();
const { requireRol, ROL_ADMIN } = require('../middleware/auth');
const { dbQuery } = require('../lib/db');
const { rangoPeriodo, fmtDT } = require('../lib/helpers');
const { fmtTiempo } = require('../assets/js/tarifa');
const { SQL_TICKET } = require('./operacion');

const ESTADOS = ['Dentro', 'Pagado', 'Cancelado'];

async function buscar(q) {
  const rango = rangoPeriodo({ periodo: q.periodo || 'hoy', desde: q.desde, hasta: q.hasta });
  const placa = String(q.placa || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const estado = ESTADOS.includes(q.estado) ? q.estado : '';
  const params = [rango.desde, rango.hasta];
  let w = 'DATE(t.entrada_at) BETWEEN ? AND ?';
  if (placa)  { w += ' AND (t.placas LIKE ? OR t.folio LIKE ?)'; params.push('%' + placa + '%', '%' + placa + '%'); }
  if (estado) { w += ' AND t.estado = ?'; params.push(estado); }
  const filas = await dbQuery(`${SQL_TICKET} WHERE ${w} ORDER BY t.entrada_at DESC LIMIT 2000`, params);
  return { rango, placa, estado, filas };
}

router.get('/', requireRol([ROL_ADMIN]), wrap(async (req, res) => {
  const { rango, placa, estado, filas } = await buscar(req.query);
  const pagados = filas.filter(f => f.estado === 'Pagado');
  const extraQuery = (placa ? '&placa=' + encodeURIComponent(placa) : '') + (estado ? '&estado=' + estado : '');
  res.render('historial', {
    titulo: 'Historial de vehículos', paginaActiva: 'historial', rango, placa, estado, filas, ESTADOS, fmtTiempo, extraQuery,
    kpi: {
      total: filas.length, pagados: pagados.length,
      cobrado: pagados.reduce((s, f) => s + (parseFloat(f.monto_cobrado) || 0), 0),
      cancelados: filas.filter(f => f.estado === 'Cancelado').length,
    },
  });
}));

// Exportar a Excel (CSV)
router.get('/csv', requireRol([ROL_ADMIN]), wrap(async (req, res) => {
  const { rango, filas } = await buscar(req.query);
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lineas = [['Folio', 'Placas', 'Tipo', 'Nombre', 'Cobro', 'Estado', 'Entrada', 'Salida', 'Minutos', 'Tiempo',
    'Monto', 'Boleto perdido', 'Método', 'Registró entrada', 'Cobró'].map(esc).join(',')];
  filas.forEach(f => lineas.push([f.folio, f.placas, f.tipo_vehiculo, f.cliente, f.tipo_cobro, f.estado, fmtDT(f.entrada_at),
    f.salida_at ? fmtDT(f.salida_at) : '', f.minutos ?? '', f.minutos != null ? fmtTiempo(f.minutos) : '', f.monto_cobrado ?? '',
    f.boleto_perdido ? 'Sí' : '', f.metodo_pago, f.cajero_entrada, f.cajero_salida].map(esc).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vehiculos_${rango.desde}_${rango.hasta}.csv"`);
  res.send('﻿' + lineas.join('\r\n'));
}));

module.exports = router;
