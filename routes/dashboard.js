// ── Dashboard del administrador ────────────────────────────────
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const router  = express.Router();
const { requireRol, ROL_ADMIN } = require('../middleware/auth');
const { dbQuery, dbFirst } = require('../lib/db');
const settings = require('../lib/settings');
const { rangoPeriodo, listaFechas } = require('../lib/helpers');

router.get('/', requireRol([ROL_ADMIN]), wrap(async (req, res) => {
  const conf = await settings.getAll();
  const rango = rangoPeriodo({ periodo: req.query.periodo || 'semana', desde: req.query.desde, hasta: req.query.hasta });
  const R = [rango.desde, rango.hasta];
  const num = v => parseFloat(v) || 0;

  // Ahora mismo
  const dentro = await dbFirst("SELECT COUNT(*) AS n FROM TICKETS WHERE estado='Dentro'");
  const capacidad = parseInt(conf.capacidad) || 0;
  const caja = await dbFirst(`SELECT s.id_sesion, s.abierta_at, u.nombre AS cajero, v.efectivo_caja, v.total_ingresos
    FROM CAJA_SESIONES s JOIN USUARIOS u ON u.id_usuario=s.id_usuario JOIN vw_ResumenCaja v ON v.id_sesion=s.id_sesion
    WHERE s.cerrada=0 ORDER BY s.abierta_at DESC LIMIT 1`);

  // Dinero del periodo (los movimientos anulados no cuentan)
  const dinero = await dbFirst(`SELECT
      IFNULL(SUM(CASE WHEN tipo='Ingreso' THEN monto END),0) AS ingresos,
      IFNULL(SUM(CASE WHEN tipo='Ingreso' AND categoria='Estacionamiento' THEN monto END),0) AS estac,
      IFNULL(SUM(CASE WHEN tipo='Ingreso' AND categoria='Pensión' THEN monto END),0) AS pension,
      IFNULL(SUM(CASE WHEN tipo='Egreso' AND categoria<>'Retiro de efectivo' THEN monto END),0) AS gastos
    FROM CAJA_MOVIMIENTOS WHERE anulado=0 AND DATE(fecha_hora) BETWEEN ? AND ?`, R);
  const veh = await dbFirst(`SELECT COUNT(*) AS salidas, IFNULL(AVG(minutos),0) AS estancia,
      IFNULL(AVG(NULLIF(monto_cobrado,0)),0) AS ticket_prom
    FROM TICKETS WHERE estado='Pagado' AND DATE(salida_at) BETWEEN ? AND ?`, R);
  const entradas = await dbFirst("SELECT COUNT(*) AS n FROM TICKETS WHERE estado<>'Cancelado' AND DATE(entrada_at) BETWEEN ? AND ?", R);

  const porDia = await dbQuery(`SELECT DATE(fecha_hora) AS d,
      SUM(CASE WHEN tipo='Ingreso' THEN monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN tipo='Egreso' AND categoria<>'Retiro de efectivo' THEN monto ELSE 0 END) AS gastos
    FROM CAJA_MOVIMIENTOS WHERE anulado=0 AND DATE(fecha_hora) BETWEEN ? AND ? GROUP BY DATE(fecha_hora)`, R);
  const serie = listaFechas(rango.desde, rango.hasta).map(f => {
    const x = porDia.find(p => String(p.d).slice(0, 10) === f);
    return { f, ingresos: x ? num(x.ingresos) : 0, gastos: x ? num(x.gastos) : 0 };
  });

  const porTipo = await dbQuery(`SELECT t.tipo_vehiculo, MAX(tf.icono) AS icono, COUNT(*) AS n, IFNULL(SUM(t.monto_cobrado),0) AS total
    FROM TICKETS t LEFT JOIN TARIFAS tf ON tf.id_tarifa=t.id_tarifa
    WHERE t.estado='Pagado' AND DATE(t.salida_at) BETWEEN ? AND ? GROUP BY t.tipo_vehiculo ORDER BY total DESC`, R);
  // Vehículos que están dentro en este momento, del que lleva más tiempo al más reciente
  const activos = await dbQuery(`SELECT t.placas, t.cliente, t.folio, t.tipo_vehiculo, t.tipo_cobro, tf.icono,
      TIMESTAMPDIFF(MINUTE, t.entrada_at, NOW()) AS mins
    FROM TICKETS t LEFT JOIN TARIFAS tf ON tf.id_tarifa=t.id_tarifa WHERE t.estado='Dentro' ORDER BY t.entrada_at`);
  const porMetodo = await dbQuery(`SELECT metodo_pago, SUM(monto) AS total FROM CAJA_MOVIMIENTOS
    WHERE anulado=0 AND tipo='Ingreso' AND DATE(fecha_hora) BETWEEN ? AND ? GROUP BY metodo_pago ORDER BY total DESC`, R);
  const porHoraRaw = await dbQuery(`SELECT HOUR(entrada_at) AS h, COUNT(*) AS n FROM TICKETS
    WHERE estado<>'Cancelado' AND DATE(entrada_at) BETWEEN ? AND ? GROUP BY HOUR(entrada_at)`, R);
  const porHora = Array.from({ length: 24 }, (_, h) => { const x = porHoraRaw.find(p => parseInt(p.h) === h); return x ? parseInt(x.n) : 0; });
  const porCajero = await dbQuery(`SELECT u.nombre, COUNT(*) AS n, SUM(m.monto) AS total FROM CAJA_MOVIMIENTOS m
    JOIN USUARIOS u ON u.id_usuario=m.id_usuario
    WHERE m.anulado=0 AND m.tipo='Ingreso' AND DATE(m.fecha_hora) BETWEEN ? AND ? GROUP BY u.id_usuario, u.nombre ORDER BY total DESC`, R);

  const cortes = await dbQuery(`SELECT s.id_sesion, s.cerrada_at, s.diferencia, s.total_ingresos, u.nombre AS cajero FROM CAJA_SESIONES s
    JOIN USUARIOS u ON u.id_usuario=s.id_usuario WHERE s.cerrada=1 ORDER BY s.cerrada_at DESC LIMIT 6`);
  const penVencen = await dbQuery(`SELECT cliente, placas, vence, DATEDIFF(vence, CURDATE()) AS dias FROM PENSIONES
    WHERE activo=1 AND vence <= DATE_ADD(CURDATE(), INTERVAL ? DAY) ORDER BY vence LIMIT 8`, [parseInt(conf.pension_aviso_dias) || 0]);

  res.render('dashboard', {
    titulo: 'Dashboard', paginaActiva: 'dashboard', rango, activos, serie, porTipo, porMetodo, porHora, porCajero, cortes, penVencen, caja,
    kpi: {
      dentro: parseInt(dentro.n) || 0, capacidad,
      ocupacion: capacidad ? Math.min(100, Math.round((parseInt(dentro.n) || 0) / capacidad * 100)) : 0,
      ingresos: num(dinero.ingresos), estac: num(dinero.estac), pension: num(dinero.pension), gastos: num(dinero.gastos),
      neta: num(dinero.ingresos) - num(dinero.gastos),
      otros: Math.max(0, num(dinero.ingresos) - num(dinero.estac) - num(dinero.pension)),
      entradas: parseInt(entradas.n) || 0, salidas: parseInt(veh.salidas) || 0,
      estancia: Math.round(num(veh.estancia)), ticketProm: num(veh.ticket_prom),
    },
  });
}));

module.exports = router;
