// ── Pensiones: clientes con mensualidad ────────────────────────
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const router  = express.Router();
const { requireRol, ROL_ADMIN, ROL_CAJERO, sesionCajaActiva, auditar, esAdmin } = require('../middleware/auth');
const { dbQuery, dbFirst, dbExecute, dbInsert, dbTx } = require('../lib/db');
const { money, fmtFecha, hoy, esc, waNumber } = require('../lib/helpers');
const settings = require('../lib/settings');

const guard = requireRol([ROL_ADMIN, ROL_CAJERO]);
const soloAdmin = requireRol([ROL_ADMIN]);
const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];
const limpiarPlacas = s => String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);

router.get('/', guard, wrap(async (req, res) => {
  const pensiones = await dbQuery(`SELECT p.*, DATEDIFF(p.vence, CURDATE()) AS dias,
      (SELECT COUNT(*) FROM TICKETS t WHERE t.placas=p.placas AND t.estado='Dentro') AS dentro
    FROM PENSIONES p WHERE p.activo=1 ORDER BY p.vence, p.cliente`);
  const pagos = await dbQuery(`SELECT m.*, u.nombre AS cajero, p.cliente, p.placas FROM CAJA_MOVIMIENTOS m
    JOIN USUARIOS u ON u.id_usuario=m.id_usuario JOIN PENSIONES p ON p.id_pension=m.id_pension
    WHERE m.anulado=0 ORDER BY m.fecha_hora DESC LIMIT 30`);
  const conf = await settings.getAll();
  const diasAviso = parseInt(conf.pension_aviso_dias) || 0;
  // Enlace para mandarle el recordatorio al cliente por WhatsApp (se abre con el mensaje ya escrito)
  pensiones.forEach(p => {
    const num = waNumber(p.telefono);
    if (num.length < 10) return;
    const txt = p.dias < 0
      ? `Hola ${p.cliente}, le recordamos que la pensión de su vehículo ${p.placas} en ${conf.negocio_nombre} venció el ${fmtFecha(p.vence)}. Le agradecemos pasar a renovarla.`
      : `Hola ${p.cliente}, le recordamos que la pensión de su vehículo ${p.placas} en ${conf.negocio_nombre} vence el ${fmtFecha(p.vence)}. Mensualidad: $${money(p.mensualidad, 0)}.`;
    p.wa = 'https://wa.me/' + num + '?text=' + encodeURIComponent(txt);
  });
  const kpi = {
    total: pensiones.length,
    vigentes: pensiones.filter(p => p.dias >= 0).length,
    vencidas: pensiones.filter(p => p.dias < 0).length,
    porVencer: pensiones.filter(p => p.dias >= 0 && p.dias <= diasAviso).length,
    mensual: pensiones.reduce((s, p) => s + (parseFloat(p.mensualidad) || 0), 0),
  };
  res.render('pensiones', { titulo: 'Pensiones', paginaActiva: 'pensiones', pensiones, pagos, kpi, admin: esAdmin(req), METODOS, hoyStr: hoy(), diasAviso });
}));

// Alta y edición: solo administrador
router.post('/guardar', soloAdmin, wrap(async (req, res) => {
  const b = req.body;
  try {
    const cliente = String(b.cliente || '').trim();
    const placas = limpiarPlacas(b.placas);
    const mensualidad = parseFloat(b.mensualidad);
    if (!cliente) throw new Error('Escribe el nombre del cliente.');
    if (placas.length < 3) throw new Error('Escribe las placas.');
    if (!(mensualidad >= 0)) throw new Error('Indica la mensualidad.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.vence || '')) throw new Error('Indica hasta qué día está pagada.');
    const id = parseInt(b.id_pension) || 0;
    const dup = await dbFirst('SELECT id_pension FROM PENSIONES WHERE placas=? AND activo=1 AND id_pension<>?', [placas, id]);
    if (dup) throw new Error('Ya hay una pensión activa con las placas ' + placas + '.');
    const datos = [cliente.slice(0, 120), String(b.telefono || '').trim().slice(0, 30) || null, placas,
      String(b.descripcion || '').trim().slice(0, 120) || null, mensualidad, b.vence, String(b.notas || '').trim().slice(0, 255) || null];
    if (id) {
      await dbExecute('UPDATE PENSIONES SET cliente=?, telefono=?, placas=?, descripcion=?, mensualidad=?, vence=?, notas=? WHERE id_pension=?', [...datos, id]);
      await auditar(req, 'EDITAR_PENSION', 'PENSIONES', id, placas);
      req.session.msg = '✅ Pensión actualizada.';
    } else {
      const nid = await dbInsert('INSERT INTO PENSIONES (cliente, telefono, placas, descripcion, mensualidad, vence, notas) VALUES (?,?,?,?,?,?,?)', datos);
      await auditar(req, 'ALTA_PENSION', 'PENSIONES', nid, placas);
      req.session.msg = '✅ Pensión registrada para ' + placas + '.';
    }
  } catch (e) { req.session.err = e.message; }
  res.redirect('/pensiones');
}));

router.post('/baja', soloAdmin, wrap(async (req, res) => {
  const id = parseInt(req.body.id_pension);
  await dbExecute('UPDATE PENSIONES SET activo=0 WHERE id_pension=?', [id]);
  await auditar(req, 'BAJA_PENSION', 'PENSIONES', id);
  req.session.msg = '✅ Pensión dada de baja.';
  res.redirect('/pensiones');
}));

// Cobrar mensualidad: cajero o administrador, entra a la caja abierta
router.post('/cobrar', guard, wrap(async (req, res) => {
  const b = req.body, u = req.session.user;
  try {
    const p = await dbFirst('SELECT * FROM PENSIONES WHERE id_pension=? AND activo=1', [parseInt(b.id_pension)]);
    if (!p) throw new Error('Pensión no encontrada.');
    const meses = Math.min(12, Math.max(1, parseInt(b.meses) || 1));
    const total = Math.round((parseFloat(p.mensualidad) || 0) * meses * 100) / 100;
    if (!(total > 0)) throw new Error('Esta pensión no tiene mensualidad capturada.');
    const ses = await sesionCajaActiva();
    if (!ses) throw new Error('Abre la caja antes de cobrar.');
    const metodo = METODOS.includes(b.metodo) ? b.metodo : 'Efectivo';

    let nuevoVence;
    await dbTx(async (conn) => {
      // Si ya estaba vencida, el mes empieza a contar desde hoy
      await conn.query('UPDATE PENSIONES SET vence = DATE_ADD(GREATEST(vence, CURDATE()), INTERVAL ? MONTH) WHERE id_pension=?', [meses, p.id_pension]);
      const [[row]] = await conn.query('SELECT vence FROM PENSIONES WHERE id_pension=?', [p.id_pension]);
      nuevoVence = String(row.vence).slice(0, 10);
      await conn.query(`INSERT INTO CAJA_MOVIMIENTOS (id_sesion,id_usuario,id_pension,tipo,categoria,concepto,monto,metodo_pago,referencia)
        VALUES (?,?,?,'Ingreso','Pensión',?,?,?,?)`,
        [ses, u.id_usuario, p.id_pension, `Pensión ${p.placas} · ${p.cliente} · ${meses} mes${meses > 1 ? 'es' : ''}`.slice(0, 200), total, metodo, 'Vence ' + fmtFecha(nuevoVence)]);
    });
    await auditar(req, 'COBRO_PENSION', 'PENSIONES', p.id_pension, `$${total} ${metodo}`);
    req.session.msg = `✅ Cobrado $${money(total)} de la pensión de ${esc(p.cliente)} (${p.placas}). Ahora vence el ${fmtFecha(nuevoVence)}.`;
  } catch (e) { req.session.err = e.message; }
  res.redirect('/pensiones');
}));

module.exports = router;
