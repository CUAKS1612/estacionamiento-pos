// ── Configuración del negocio (administrador) ──────────────────
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const router  = express.Router();
const { requireRol, ROL_ADMIN, auditar } = require('../middleware/auth');
const settings = require('../lib/settings');

const guard = requireRol([ROL_ADMIN]);

router.get('/', guard, wrap(async (req, res) => {
  res.render('configuracion', { titulo: 'Configuración', paginaActiva: 'configuracion', conf: await settings.getAll(true) });
}));

router.post('/', guard, wrap(async (req, res) => {
  const b = req.body;
  try {
    const nombre = String(b.negocio_nombre || '').trim().slice(0, 80);
    if (!nombre) throw new Error('Escribe el nombre del negocio.');
    const capacidad = parseInt(b.capacidad);
    if (!(capacidad >= 1 && capacidad <= 5000)) throw new Error('Indica cuántos cajones tiene el estacionamiento.');
    const diasAviso = parseInt(b.pension_aviso_dias);
    if (!(diasAviso >= 0 && diasAviso <= 30)) throw new Error('Los días de aviso deben ser de 0 a 30.');
    await settings.set({
      pension_aviso_dias: diasAviso,
      negocio_nombre:    nombre,
      negocio_direccion: String(b.negocio_direccion || '').trim().slice(0, 200),
      negocio_telefono:  String(b.negocio_telefono || '').trim().slice(0, 40),
      negocio_horario:   String(b.negocio_horario || '').trim().slice(0, 120),
      capacidad,
      ticket_leyenda:    String(b.ticket_leyenda || '').trim().slice(0, 400),
    });
    await auditar(req, 'CONFIGURACION', 'CONFIGURACION', 0, nombre + ' · ' + capacidad + ' cajones');
    req.session.msg = '✅ Configuración guardada.';
  } catch (e) { req.session.err = e.message; }
  res.redirect('/configuracion');
}));

module.exports = router;
