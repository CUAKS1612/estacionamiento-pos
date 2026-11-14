// ── Tarifa única y tipos de vehículo (administrador) ───────────
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const router  = express.Router();
const { requireRol, ROL_ADMIN, auditar } = require('../middleware/auth');
const { dbQuery, dbExecute, dbInsert } = require('../lib/db');
const settings = require('../lib/settings');

const guard = requireRol([ROL_ADMIN]);

router.get('/', guard, wrap(async (req, res) => {
  const tipos = await dbQuery('SELECT * FROM TARIFAS ORDER BY activo DESC, orden, id_tarifa');
  res.render('tarifas', { titulo: 'Tarifa', paginaActiva: 'tarifas', tipos, conf: await settings.getAll(true) });
}));

router.post('/', guard, wrap(async (req, res) => {
  const b = req.body;
  try {
    if (b.accion === 'tarifa') {
      const hora = parseFloat(b.tarifa_hora), tol = parseInt(b.tolerancia_min), perdido = parseFloat(b.cargo_boleto_perdido);
      if (!(hora > 0)) throw new Error('Indica cuánto cuesta la hora.');
      if (!(tol >= 0 && tol <= 60)) throw new Error('La tolerancia debe ser de 0 a 60 minutos.');
      if (!(perdido >= 0)) throw new Error('Revisa el cargo por boleto perdido.');
      await settings.set({ tarifa_hora: hora, tolerancia_min: tol, cargo_boleto_perdido: perdido });
      await auditar(req, 'TARIFA', 'CONFIGURACION', 0, `Hora $${hora} · Tolerancia ${tol} min · Boleto perdido $${perdido}`);
      req.session.msg = '✅ Tarifa guardada. Aplica también a los vehículos que ya están dentro.';
    } else if (b.accion === 'tipo') {
      const nombre = String(b.nombre || '').trim().slice(0, 40);
      if (!nombre) throw new Error('Escribe el nombre del tipo de vehículo.');
      const datos = [nombre, String(b.icono || '🚗').trim().slice(0, 8) || '🚗', parseInt(b.orden) || 0];
      const id = parseInt(b.id_tarifa) || 0;
      if (id) await dbExecute('UPDATE TARIFAS SET nombre=?, icono=?, orden=? WHERE id_tarifa=?', [...datos, id]);
      else await dbInsert('INSERT INTO TARIFAS (nombre, icono, orden) VALUES (?,?,?)', datos);
      req.session.msg = '✅ Tipo de vehículo guardado.';
    } else if (b.accion === 'activar') {
      await dbExecute('UPDATE TARIFAS SET activo=? WHERE id_tarifa=?', [b.activo === '1' ? 1 : 0, parseInt(b.id_tarifa)]);
      req.session.msg = '✅ Listo.';
    }
  } catch (e) { req.session.err = e.message; }
  res.redirect('/tarifas');
}));

module.exports = router;
