// ── Caja: apertura, gastos, retiros, corte ─────────────────────
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const router  = express.Router();
const { requireRol, ROL_ADMIN, ROL_CAJERO, sesionCajaActiva, auditar, turnoActual, esAdmin } = require('../middleware/auth');
const { dbQuery, dbFirst, dbExecute, dbInsert } = require('../lib/db');
const { money, hoy } = require('../lib/helpers');

const guard = requireRol([ROL_ADMIN, ROL_CAJERO]);
const CAT_EGRESO = ['Insumos', 'Limpieza', 'Mantenimiento', 'Servicios (luz, agua, internet)', 'Sueldos', 'Otros'];
const CAT_RETIRO = 'Retiro de efectivo';
const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];

async function resumenSesion(id) {
  const resumen = await dbFirst('SELECT * FROM vw_ResumenCaja WHERE id_sesion=?', [id]);
  const porCategoria = await dbQuery(`SELECT categoria,
      SUM(CASE WHEN tipo='Ingreso' THEN monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN tipo='Egreso'  THEN monto ELSE 0 END) AS egresos, COUNT(*) AS cnt
    FROM CAJA_MOVIMIENTOS WHERE id_sesion=? AND anulado=0 GROUP BY categoria ORDER BY ingresos DESC, egresos DESC`, [id]);
  const porMetodo = await dbQuery(`SELECT metodo_pago,
      SUM(CASE WHEN tipo='Ingreso' THEN monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN tipo='Egreso'  THEN monto ELSE 0 END) AS egresos, COUNT(*) AS cnt
    FROM CAJA_MOVIMIENTOS WHERE id_sesion=? AND anulado=0 GROUP BY metodo_pago ORDER BY ingresos DESC`, [id]);
  const vehiculos = await dbFirst("SELECT COUNT(*) AS n FROM TICKETS WHERE id_sesion=? AND estado='Pagado'", [id]);
  const ing = parseFloat(resumen?.total_ingresos) || 0;
  const gas = parseFloat(resumen?.total_gastos) || 0;
  const ret = parseFloat(resumen?.total_retiros) || 0;
  return { resumen, porCategoria, porMetodo, totIngresos: ing, totGastos: gas, totRetiros: ret,
    neta: Math.round((ing - gas) * 100) / 100, vehiculosCobrados: parseInt(vehiculos.n) || 0 };
}

const SQL_MOVS = `SELECT m.*, u.nombre AS cajero FROM CAJA_MOVIMIENTOS m
  JOIN USUARIOS u ON u.id_usuario=m.id_usuario WHERE m.id_sesion=?`;

router.get('/', guard, wrap(async (req, res) => {
  const admin = esAdmin(req);
  const sesActiva = await dbFirst(`SELECT s.*, u.nombre AS cajero FROM CAJA_SESIONES s
    JOIN USUARIOS u ON u.id_usuario=s.id_usuario WHERE s.cerrada=0 ORDER BY s.abierta_at DESC LIMIT 1`);
  let datos = { resumen: null, porCategoria: [], porMetodo: [], neta: 0, totIngresos: 0, totGastos: 0, totRetiros: 0, vehiculosCobrados: 0 };
  let movimientos = [];
  if (sesActiva) {
    datos = await resumenSesion(sesActiva.id_sesion);
    movimientos = await dbQuery(SQL_MOVS + ' ORDER BY m.fecha_hora DESC', [sesActiva.id_sesion]);
  }
  // El cajero solo ve los cortes de hoy; el administrador, todos
  const historial = await dbQuery(`SELECT s.*, u.nombre AS cajero, uc.nombre AS cerro
    FROM CAJA_SESIONES s JOIN USUARIOS u ON u.id_usuario=s.id_usuario
    LEFT JOIN USUARIOS uc ON uc.id_usuario=s.id_usuario_cierre
    WHERE s.cerrada=1 ${admin ? '' : 'AND DATE(s.cerrada_at)=CURDATE()'} ORDER BY s.cerrada_at DESC LIMIT 60`);
  const ultimo = await dbFirst('SELECT efectivo_contado FROM CAJA_SESIONES WHERE cerrada=1 ORDER BY cerrada_at DESC LIMIT 1');
  const dentro = await dbFirst("SELECT COUNT(*) AS n FROM TICKETS WHERE estado='Dentro'");
  res.render('caja', { titulo: 'Caja', paginaActiva: 'caja', sesActiva, ...datos, movimientos, historial, admin,
    CAT_EGRESO, METODOS, dentro: parseInt(dentro.n) || 0, fondoSugerido: ultimo?.efectivo_contado || '' });
}));

// Corte imprimible
router.get('/corte/:id(\\d+)', guard, wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const ses = await dbFirst(`SELECT s.*, u.nombre AS cajero, uc.nombre AS cerro FROM CAJA_SESIONES s
    JOIN USUARIOS u ON u.id_usuario=s.id_usuario LEFT JOIN USUARIOS uc ON uc.id_usuario=s.id_usuario_cierre WHERE s.id_sesion=?`, [id]);
  if (!ses) return res.status(404).render('error', { codigo: 404, mensaje: 'Corte no encontrado' });
  if (!esAdmin(req) && ses.cerrada && String(ses.cerrada_at).slice(0, 10) !== hoy()) {
    return res.status(403).render('error', { codigo: 403, mensaje: 'Solo el administrador puede ver cortes anteriores.' });
  }
  const datos = await resumenSesion(id);
  const movimientos = await dbQuery(SQL_MOVS + ' AND m.anulado=0 ORDER BY m.fecha_hora', [id]);
  res.render('caja_corte', { ses, ...datos, movimientos });
}));

router.post('/', guard, wrap(async (req, res) => {
  const b = req.body, userId = req.session.user.id_usuario, admin = esAdmin(req);
  let msg = '', err = '';
  try {
    if (b.accion === 'abrir') {
      const abierta = await sesionCajaActiva();
      if (abierta) throw new Error('Ya hay una caja abierta (#' + abierta + '). Ciérrala antes de abrir otra.');
      const fondo = parseFloat(b.fondo);
      if (!(fondo >= 0)) throw new Error('Indica con cuánto efectivo empieza la caja.');
      const id = await dbInsert('INSERT INTO CAJA_SESIONES (id_usuario,turno,fondo_inicial) VALUES (?,?,?)', [userId, turnoActual(), fondo]);
      await auditar(req, 'ABRIR_CAJA', 'CAJA_SESIONES', id, 'Fondo: $' + fondo);
      msg = '✅ Caja #' + id + ' abierta con fondo de $' + money(fondo);
    }
    else if (b.accion === 'cerrar') {
      const idSes = await sesionCajaActiva();
      if (!idSes) throw new Error('No hay caja abierta.');
      const contado = parseFloat(b.efectivo_contado);
      if (!(contado >= 0)) throw new Error('Captura el efectivo que contaste físicamente.');
      const r = await dbFirst('SELECT * FROM vw_ResumenCaja WHERE id_sesion=?', [idSes]);
      const esperado = parseFloat(r.efectivo_caja);
      const dif = Math.round((contado - esperado) * 100) / 100;
      const n = await dbExecute(`UPDATE CAJA_SESIONES SET cerrada=1, cerrada_at=NOW(), notas_cierre=?, efectivo_esperado=?, efectivo_contado=?,
        diferencia=?, total_ingresos=?, total_egresos=?, id_usuario_cierre=? WHERE id_sesion=? AND cerrada=0`,
        [String(b.notas || '').trim() || null, esperado, contado, dif, r.total_ingresos, r.total_egresos, userId, idSes]);
      if (!n) throw new Error('La caja ya estaba cerrada.');
      await auditar(req, 'CERRAR_CAJA', 'CAJA_SESIONES', idSes, `Esperado $${esperado} · Contado $${contado} · Dif $${dif}`);
      msg = `✅ Caja #${idSes} cerrada. Esperado $${money(esperado)} · Contado $${money(contado)} · ` +
        (Math.abs(dif) < 0.01 ? 'Sin diferencia 👌' : (dif > 0 ? 'Sobrante $' + money(dif) : 'Faltante $' + money(-dif))) +
        ` · <a href="/caja/corte/${idSes}" target="_blank">🖨️ Imprimir corte</a>`;
    }
    else if (b.accion === 'gasto' || b.accion === 'ingreso') {
      const idSes = await sesionCajaActiva();
      if (!idSes) throw new Error('No hay caja abierta.');
      const monto = parseFloat(b.monto);
      if (!(monto > 0)) throw new Error('Monto inválido.');
      const concepto = String(b.concepto || '').trim();
      if (!concepto) throw new Error('Escribe el concepto.');
      const esGasto = b.accion === 'gasto';
      const metodo = METODOS.includes(b.metodo_pago) ? b.metodo_pago : 'Efectivo';
      if (esGasto && metodo === 'Efectivo') {
        const r = await dbFirst('SELECT efectivo_caja FROM vw_ResumenCaja WHERE id_sesion=?', [idSes]);
        if (monto > (parseFloat(r?.efectivo_caja) || 0) + 0.009) throw new Error('No hay suficiente efectivo en caja para ese gasto.');
      }
      await dbInsert('INSERT INTO CAJA_MOVIMIENTOS (id_sesion,id_usuario,tipo,categoria,concepto,monto,metodo_pago) VALUES (?,?,?,?,?,?,?)',
        [idSes, userId, esGasto ? 'Egreso' : 'Ingreso',
         esGasto ? (CAT_EGRESO.includes(b.categoria) ? b.categoria : 'Otros') : 'Otro ingreso', concepto.slice(0, 200), monto, metodo]);
      msg = `✅ ${esGasto ? 'Gasto' : 'Ingreso'} de $${money(monto)} registrado.`;
    }
    else if (b.accion === 'retiro') {
      if (!admin) throw new Error('Solo el administrador puede retirar efectivo de la caja.');
      const idSes = await sesionCajaActiva();
      if (!idSes) throw new Error('No hay caja abierta.');
      const monto = parseFloat(b.monto);
      if (!(monto > 0)) throw new Error('Indica cuánto se va a retirar.');
      const motivo = String(b.motivo || '').trim();
      if (!motivo) throw new Error('Escribe el motivo del retiro.');
      const r = await dbFirst('SELECT efectivo_caja FROM vw_ResumenCaja WHERE id_sesion=?', [idSes]);
      const enCaja = parseFloat(r?.efectivo_caja) || 0;
      if (monto > enCaja + 0.009) throw new Error('No hay suficiente efectivo. Disponible: $' + money(enCaja));
      const idMov = await dbInsert(`INSERT INTO CAJA_MOVIMIENTOS (id_sesion,id_usuario,tipo,categoria,concepto,monto,metodo_pago)
        VALUES (?,?,'Egreso',?,?,?,'Efectivo')`, [idSes, userId, CAT_RETIRO, ('Retiro: ' + motivo).slice(0, 200), monto]);
      await auditar(req, 'RETIRO', 'CAJA_MOVIMIENTOS', idMov, '$' + monto + ' — ' + motivo);
      msg = '💰 Retiro de $' + money(monto) + ' registrado. Quedan $' + money(enCaja - monto) + ' en caja.';
    }
    else if (b.accion === 'anular') {
      if (!admin) throw new Error('Solo el administrador puede anular movimientos.');
      const motivo = String(b.motivo || '').trim();
      if (!motivo) throw new Error('Indica el motivo de la anulación.');
      const mov = await dbFirst(`SELECT m.*, s.cerrada FROM CAJA_MOVIMIENTOS m JOIN CAJA_SESIONES s ON s.id_sesion=m.id_sesion
        WHERE m.id_movimiento=?`, [parseInt(b.id_movimiento)]);
      if (!mov) throw new Error('Movimiento no encontrado.');
      if (mov.anulado) throw new Error('Ese movimiento ya estaba anulado.');
      if (mov.cerrada) throw new Error('No se pueden anular movimientos de una caja ya cerrada.');
      await dbExecute('UPDATE CAJA_MOVIMIENTOS SET anulado=1, anulado_motivo=? WHERE id_movimiento=?', [motivo.slice(0, 200), mov.id_movimiento]);
      // Si era el cobro de un vehículo, el ticket queda cancelado para que no cuente como venta
      if (mov.id_ticket) {
        await dbExecute("UPDATE TICKETS SET estado='Cancelado', cancel_motivo=? WHERE id_ticket=?", [('Cobro anulado: ' + motivo).slice(0, 200), mov.id_ticket]);
      }
      await auditar(req, 'ANULAR', 'CAJA_MOVIMIENTOS', mov.id_movimiento, motivo);
      msg = '✅ Movimiento #' + mov.id_movimiento + ' anulado.';
    }
  } catch (e) { err = e.message; }
  req.session.msg = msg; req.session.err = err;
  res.redirect('/caja');
}));

module.exports = router;
