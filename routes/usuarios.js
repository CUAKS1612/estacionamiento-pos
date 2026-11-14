// ── Usuarios: administradores y cajeros ────────────────────────
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { requireRol, ROL_ADMIN, ROL_CAJERO, auditar } = require('../middleware/auth');
const { dbQuery, dbFirst, dbExecute, dbInsert } = require('../lib/db');

const guard = requireRol([ROL_ADMIN]);

router.get('/', guard, wrap(async (req, res) => {
  const usuarios = await dbQuery(`SELECT u.id_usuario, u.nombre, u.usuario, u.id_rol, u.activo, u.created_at, r.nombre AS nombre_rol,
      (SELECT MAX(a.fecha_hora) FROM AUDITORIA a WHERE a.id_usuario=u.id_usuario AND a.accion='LOGIN') AS ultimo_acceso
    FROM USUARIOS u JOIN ROLES r ON r.id_rol=u.id_rol ORDER BY u.activo DESC, u.id_rol, u.nombre`);
  const bitacora = await dbQuery(`SELECT a.*, u.nombre FROM AUDITORIA a LEFT JOIN USUARIOS u ON u.id_usuario=a.id_usuario
    WHERE a.accion NOT IN ('LOGIN','LOGOUT') ORDER BY a.fecha_hora DESC LIMIT 40`);
  res.render('usuarios', { titulo: 'Usuarios', paginaActiva: 'usuarios', usuarios, bitacora, yo: req.session.user.id_usuario });
}));

/** Evita que el negocio se quede sin ningún administrador activo */
async function quedaOtroAdmin(idExcluido) {
  const r = await dbFirst('SELECT COUNT(*) AS n FROM USUARIOS WHERE id_rol=? AND activo=1 AND id_usuario<>?', [ROL_ADMIN, idExcluido]);
  return parseInt(r.n) > 0;
}

router.post('/', guard, wrap(async (req, res) => {
  const b = req.body, yo = req.session.user.id_usuario;
  try {
    if (b.accion === 'guardar') {
      const id = parseInt(b.id_usuario) || 0;
      const nombre = String(b.nombre || '').trim().slice(0, 120);
      const usuario = String(b.usuario || '').trim().toLowerCase();
      const rol = parseInt(b.id_rol) === ROL_ADMIN ? ROL_ADMIN : ROL_CAJERO;
      const pass = String(b.password || '');
      if (!nombre) throw new Error('Escribe el nombre de la persona.');
      if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new Error('El usuario debe tener de 3 a 40 letras o números, sin espacios.');
      const dup = await dbFirst('SELECT id_usuario FROM USUARIOS WHERE LOWER(usuario)=? AND id_usuario<>?', [usuario, id]);
      if (dup) throw new Error('Ya existe el usuario "' + usuario + '".');
      if (id) {
        if (rol !== ROL_ADMIN && !(await quedaOtroAdmin(id))) {
          const era = await dbFirst('SELECT id_rol FROM USUARIOS WHERE id_usuario=?', [id]);
          if (era && era.id_rol === ROL_ADMIN) throw new Error('Debe quedar al menos un administrador.');
        }
        await dbExecute('UPDATE USUARIOS SET nombre=?, usuario=?, id_rol=? WHERE id_usuario=?', [nombre, usuario, rol, id]);
        if (pass) {
          if (pass.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
          await dbExecute('UPDATE USUARIOS SET password_hash=? WHERE id_usuario=?', [await bcrypt.hash(pass, 10), id]);
        }
        await auditar(req, 'EDITAR_USUARIO', 'USUARIOS', id, usuario + (pass ? ' (nueva contraseña)' : ''));
        if (id === yo) { req.session.user.nombre = nombre; req.session.user.usuario = usuario; }
        req.session.msg = '✅ Usuario actualizado.';
      } else {
        if (pass.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        const nid = await dbInsert('INSERT INTO USUARIOS (nombre, usuario, password_hash, id_rol) VALUES (?,?,?,?)',
          [nombre, usuario, await bcrypt.hash(pass, 10), rol]);
        await auditar(req, 'ALTA_USUARIO', 'USUARIOS', nid, usuario);
        req.session.msg = `✅ Usuario "${usuario}" creado.`;
      }
    } else if (b.accion === 'activar') {
      const id = parseInt(b.id_usuario), activo = b.activo === '1' ? 1 : 0;
      if (!activo) {
        if (id === yo) throw new Error('No puedes darte de baja a ti mismo.');
        const u = await dbFirst('SELECT id_rol FROM USUARIOS WHERE id_usuario=?', [id]);
        if (u && u.id_rol === ROL_ADMIN && !(await quedaOtroAdmin(id))) throw new Error('Debe quedar al menos un administrador.');
      }
      await dbExecute('UPDATE USUARIOS SET activo=? WHERE id_usuario=?', [activo, id]);
      await auditar(req, activo ? 'REACTIVAR_USUARIO' : 'BAJA_USUARIO', 'USUARIOS', id);
      req.session.msg = activo ? '✅ Usuario reactivado.' : '✅ Usuario dado de baja: ya no puede entrar.';
    }
  } catch (e) { req.session.err = e.message; }
  res.redirect('/usuarios');
}));

module.exports = router;
