// ── Login / Logout / Mi cuenta ─────────────────────────────────
'use strict';
const wrap    = require('../lib/asyncHandler');
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const auth    = require('../middleware/auth');
const { dbFirst, dbExecute } = require('../lib/db');

// Límite simple de intentos por IP (anti fuerza bruta)
const intentos = new Map();
function bloqueado(ip) {
  const r = intentos.get(ip);
  if (!r) return false;
  if (Date.now() - r.t > 15 * 60 * 1000) { intentos.delete(ip); return false; }
  return r.n >= 10;
}
function fallo(ip) {
  const r = intentos.get(ip) || { n: 0, t: Date.now() };
  r.n++; r.t = Date.now(); intentos.set(ip, r);
}

router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(auth.urlDefaultPorRol(req.session.user.id_rol));
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(auth.urlDefaultPorRol(req.session.user.id_rol));
  res.render('login', { error: '', usuarioPrev: '' });
});

router.post('/login', wrap(async (req, res, next) => {
  const usuario = String(req.body.usuario || '').trim();
  const password = String(req.body.password || '');
  if (bloqueado(req.ip)) return res.render('login', { error: 'Demasiados intentos. Espera 15 minutos.', usuarioPrev: usuario });
  if (!usuario || !password) return res.render('login', { error: 'Escribe tu usuario y contraseña.', usuarioPrev: usuario });
  const u = await auth.login(usuario, password, req.ip);
  if (!u) {
    fallo(req.ip);
    return res.render('login', { error: 'Usuario o contraseña incorrectos.', usuarioPrev: usuario });
  }
  intentos.delete(req.ip);
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.user = u;
    req.session.save(() => res.redirect(auth.urlDefaultPorRol(u.id_rol)));
  });
}));

router.get('/logout', wrap(async (req, res) => {
  if (req.session.user) await auth.auditar(req, 'LOGOUT', 'USUARIOS', req.session.user.id_usuario, 'Cierre de sesión');
  req.session.destroy(() => res.redirect('/login'));
}));

// ── Mi cuenta: cambiar mi propia contraseña ────────────────────
const guard = auth.requireRol([auth.ROL_ADMIN, auth.ROL_CAJERO]);

router.get('/cuenta', guard, (req, res) => {
  res.render('cuenta', { titulo: 'Mi cuenta', paginaActiva: 'cuenta' });
});

router.post('/cuenta', guard, wrap(async (req, res) => {
  const b = req.body, id = req.session.user.id_usuario;
  try {
    const u = await dbFirst('SELECT password_hash FROM USUARIOS WHERE id_usuario=?', [id]);
    if (!(await bcrypt.compare(String(b.actual || ''), u.password_hash))) throw new Error('La contraseña actual no es correcta.');
    const nueva = String(b.nueva || '');
    if (nueva.length < 6) throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
    if (nueva !== String(b.repetir || '')) throw new Error('Las contraseñas nuevas no coinciden.');
    await dbExecute('UPDATE USUARIOS SET password_hash=? WHERE id_usuario=?', [await bcrypt.hash(nueva, 10), id]);
    await auth.auditar(req, 'CAMBIO_PASSWORD', 'USUARIOS', id);
    req.session.msg = '✅ Contraseña actualizada.';
  } catch (e) { req.session.err = e.message; }
  res.redirect('/cuenta');
}));

module.exports = router;
