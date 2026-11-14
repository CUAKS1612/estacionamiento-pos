// ── Operación: entradas, vehículos dentro y cobro de salidas ───
'use strict';
const wrap = require('../lib/asyncHandler');
const express = require('express');
const router  = express.Router();
const { requireRol, ROL_ADMIN, ROL_CAJERO, sesionCajaActiva, auditar, esAdmin } = require('../middleware/auth');
const { dbQuery, dbFirst, dbInsert, dbExecute, dbTx, nextFolio } = require('../lib/db');
const settings = require('../lib/settings');
const { money, esc } = require('../lib/helpers');
const { calcularMonto, fmtTiempo } = require('../assets/js/tarifa');

const guard = requireRol([ROL_ADMIN, ROL_CAJERO]);
const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];
const VIGENCIA_COTIZACION = 5 * 60 * 1000;   // el monto mostrado al cajero vale 5 minutos

const limpiarPlacas = s => String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);

const SQL_TICKET = `SELECT t.*, TIMESTAMPDIFF(SECOND, t.entrada_at, NOW()) AS seg,
    tf.icono,
    ue.nombre AS cajero_entrada, us.nombre AS cajero_salida
  FROM TICKETS t
  LEFT JOIN TARIFAS tf ON tf.id_tarifa = t.id_tarifa
  JOIN USUARIOS ue ON ue.id_usuario = t.id_usuario_entrada
  LEFT JOIN USUARIOS us ON us.id_usuario = t.id_usuario_salida`;

/** Agrega al ticket los minutos que lleva y lo que debe en este momento */
function cotizar(t, conf) {
  t.mins = Math.max(0, Math.floor((parseInt(t.seg) || 0) / 60));
  t.monto = t.tipo_cobro === 'Pension' ? 0 : calcularMonto(t.mins, conf.tarifa_hora, conf.tolerancia_min);
  return t;
}

router.get('/', guard, wrap(async (req, res) => {
  const conf = await settings.getAll();
  const tarifas = await dbQuery('SELECT * FROM TARIFAS WHERE activo=1 ORDER BY orden, id_tarifa');
  const activos = await dbQuery(SQL_TICKET + " WHERE t.estado='Dentro' ORDER BY t.entrada_at DESC");
  activos.forEach(t => cotizar(t, conf));

  const hoy = await dbFirst(`SELECT
      (SELECT COUNT(*) FROM TICKETS WHERE DATE(entrada_at)=CURDATE() AND estado<>'Cancelado') AS entradas,
      (SELECT COUNT(*) FROM TICKETS WHERE DATE(salida_at)=CURDATE() AND estado='Pagado') AS salidas,
      (SELECT IFNULL(SUM(monto_cobrado),0) FROM TICKETS WHERE DATE(salida_at)=CURDATE() AND estado='Pagado') AS cobrado`);
  const ultimas = await dbQuery(SQL_TICKET + " WHERE t.estado='Pagado' AND DATE(t.salida_at)=CURDATE() ORDER BY t.salida_at DESC LIMIT 8");

  const capacidad = parseInt(conf.capacidad) || 0;
  const imprimir = req.session.imprimir || null; delete req.session.imprimir;
  res.render('operacion', {
    titulo: 'Entradas y salidas', paginaActiva: 'operacion',
    conf, tarifas, activos, hoy, ultimas, capacidad, imprimir,
    libres: Math.max(0, capacidad - activos.length),
  });
}));

// ── Registrar entrada ──────────────────────────────────────────
router.post('/entrada', guard, wrap(async (req, res) => {
  const u = req.session.user, b = req.body;
  try {
    const conf = await settings.getAll();
    const placas = limpiarPlacas(b.placas);
    if (placas.length < 3) throw new Error('Escribe las placas del vehículo.');
    const tarifa = await dbFirst('SELECT * FROM TARIFAS WHERE id_tarifa=? AND activo=1', [parseInt(b.id_tarifa)]);
    if (!tarifa) throw new Error('Elige el tipo de vehículo.');
    
    const dup = await dbFirst("SELECT folio FROM TICKETS WHERE placas=? AND estado='Dentro'", [placas]);
    if (dup) throw new Error(`El vehículo ${placas} ya está dentro (ticket ${dup.folio}).`);

    // ¿Es pensionado? Si su mensualidad está vigente entra sin costo
    const pen = await dbFirst('SELECT *, (vence >= CURDATE()) AS vigente, DATEDIFF(vence, CURDATE()) AS dias FROM PENSIONES WHERE placas=? AND activo=1 ORDER BY vence DESC LIMIT 1', [placas]);
    const esPension = !!(pen && parseInt(pen.vigente));

    const folio = 'T-' + String(await nextFolio('FOLIO_TICKET')).padStart(6, '0');
    const id = await dbInsert(`INSERT INTO TICKETS (folio, placas, id_tarifa, tipo_vehiculo, cliente, tipo_cobro, id_pension, id_usuario_entrada)
      VALUES (?,?,?,?,?,?,?,?)`,
      [folio, placas, tarifa.id_tarifa, tarifa.nombre, String(b.cliente || '').trim().slice(0, 120) || (esPension ? pen.cliente : null),
       esPension ? 'Pension' : 'Tiempo', esPension ? pen.id_pension : null, u.id_usuario]);

    req.session.imprimir = id;
    req.session.msg = `✅ Entrada registrada: <strong>${placas}</strong> · Ticket ${folio}` +
      (esPension ? ` · 📇 Pensionado (${esc(pen.cliente)})` : '') +
      (esPension && pen.dias <= (parseInt(conf.pension_aviso_dias) || 0) ? ` · <strong>⏰ Avísale: su pensión ${pen.dias === 0 ? 'vence hoy' : (pen.dias === 1 ? 'vence mañana' : 'vence en ' + pen.dias + ' días')}</strong>` : '') +
      (pen && !esPension ? ' · <strong>⚠️ Su pensión está vencida, entra con tarifa normal</strong>' : '') +
      ` · <a href="/operacion/ticket/${id}" target="_blank">🖨️ Reimprimir</a>`;
  } catch (e) { req.session.err = e.message; }
  res.redirect('/operacion');
}));

// ── Pantalla de cobro ──────────────────────────────────────────
router.get('/cobrar/:id(\\d+)', guard, wrap(async (req, res) => {
  const conf = await settings.getAll();
  const t = await dbFirst(SQL_TICKET + " WHERE t.id_ticket=? AND t.estado='Dentro'", [parseInt(req.params.id)]);
  if (!t) { req.session.err = 'Ese vehículo ya salió o el ticket no existe.'; return res.redirect('/operacion'); }
  cotizar(t, conf);
  // El monto queda guardado del lado del servidor: lo que se muestra es lo que se cobra
  req.session.cotizacion = { id: t.id_ticket, mins: t.mins, monto: t.monto, at: Date.now() };
  res.render('cobrar', {
    titulo: 'Cobrar salida', paginaActiva: 'operacion', t, conf, METODOS, fmtTiempo,
    cargoPerdido: parseFloat(conf.cargo_boleto_perdido) || 0,
    sesionCaja: await sesionCajaActiva(),
  });
}));

router.post('/cobrar/:id(\\d+)', guard, wrap(async (req, res) => {
  const u = req.session.user, b = req.body, id = parseInt(req.params.id);
  try {
    const cot = req.session.cotizacion;
    if (!cot || cot.id !== id || Date.now() - cot.at > VIGENCIA_COTIZACION) {
      req.session.err = 'Pasó mucho tiempo desde que se calculó el cobro. Revisa el nuevo monto y confirma.';
      return res.redirect('/operacion/cobrar/' + id);
    }
    const t = await dbFirst("SELECT * FROM TICKETS WHERE id_ticket=? AND estado='Dentro'", [id]);
    if (!t) throw new Error('Ese vehículo ya salió o el ticket no existe.');

    const conf = await settings.getAll();
    const perdido = b.boleto_perdido === '1' && t.tipo_cobro !== 'Pension';
    const extra = perdido ? (parseFloat(conf.cargo_boleto_perdido) || 0) : 0;
    const total = Math.round((cot.monto + extra) * 100) / 100;
    const metodo = METODOS.includes(b.metodo) ? b.metodo : 'Efectivo';

    let ses = null, recibido = null, cambio = null;
    if (total > 0) {
      ses = await sesionCajaActiva();
      if (!ses) throw new Error('Abre la caja antes de cobrar.');
      if (metodo === 'Efectivo') {
        recibido = b.recibido === '' || b.recibido == null ? total : parseFloat(b.recibido);
        if (!(recibido >= total)) throw new Error('El efectivo recibido no alcanza: son $' + money(total) + '.');
        cambio = Math.round((recibido - total) * 100) / 100;
      }
    }

    await dbTx(async (conn) => {
      const [r] = await conn.query(`UPDATE TICKETS SET estado='Pagado', salida_at=NOW(), id_usuario_salida=?, id_sesion=?,
          minutos=?, monto_tiempo=?, cargo_extra=?, boleto_perdido=?, monto_cobrado=?, metodo_pago=?, pago_recibido=?, cambio=?
        WHERE id_ticket=? AND estado='Dentro'`,
        [u.id_usuario, ses, cot.mins, cot.monto, extra, perdido ? 1 : 0, total, total > 0 ? metodo : null, recibido, cambio, id]);
      if (!r.affectedRows) throw new Error('Ese vehículo ya fue cobrado en otra pantalla.');
      if (total > 0) {
        await conn.query(`INSERT INTO CAJA_MOVIMIENTOS (id_sesion,id_usuario,id_ticket,tipo,categoria,concepto,monto,metodo_pago,referencia)
          VALUES (?,?,?,'Ingreso','Estacionamiento',?,?,?,?)`,
          [ses, u.id_usuario, id, `${t.tipo_vehiculo} ${t.placas} · ${fmtTiempo(cot.mins)}` + (perdido ? ' · boleto perdido' : ''), total, metodo, t.folio]);
      }
    });
    delete req.session.cotizacion;
    await auditar(req, 'SALIDA', 'TICKETS', id, `${t.placas} ${fmtTiempo(cot.mins)} $${total} ${metodo}`);

    req.session.imprimir = id;
    req.session.msg = `✅ Salida de <strong>${t.placas}</strong> · ${fmtTiempo(cot.mins)} · ` +
      (total > 0 ? `Cobrado $${money(total)} (${metodo})` : (t.tipo_cobro === 'Pension' ? 'Pensionado, sin cobro' : 'Dentro de la tolerancia, sin cobro')) +
      (cambio > 0 ? ` · <strong>Cambio: $${money(cambio)}</strong>` : '') +
      ` · <a href="/operacion/ticket/${id}" target="_blank">🖨️ Reimprimir</a>`;
    return res.redirect('/operacion');
  } catch (e) {
    req.session.err = e.message;
    return res.redirect('/operacion/cobrar/' + id);
  }
}));

// ── Ticket imprimible (entrada o comprobante de pago) ──────────
router.get('/ticket/:id(\\d+)', guard, wrap(async (req, res) => {
  const t = await dbFirst(SQL_TICKET + ' WHERE t.id_ticket=?', [parseInt(req.params.id)]);
  if (!t) return res.status(404).render('error', { codigo: 404, mensaje: 'Ticket no encontrado' });
  const ahora = await dbFirst("SELECT DATE_FORMAT(NOW(),'%d/%m/%Y %H:%i') t");
  res.render('ticket', { t, conf: await settings.getAll(), impreso: ahora.t, fmtTiempo });
}));

// ── Cancelar un ticket que sigue dentro (solo administrador) ───
router.post('/cancelar/:id(\\d+)', requireRol([ROL_ADMIN]), wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) throw new Error('Escribe el motivo de la cancelación.');
    const n = await dbExecute("UPDATE TICKETS SET estado='Cancelado', salida_at=NOW(), id_usuario_salida=?, monto_cobrado=0, cancel_motivo=? WHERE id_ticket=? AND estado='Dentro'",
      [req.session.user.id_usuario, motivo.slice(0, 200), id]);
    if (!n) throw new Error('Solo se pueden cancelar tickets de vehículos que siguen dentro.');
    await auditar(req, 'CANCELAR_TICKET', 'TICKETS', id, motivo);
    req.session.msg = '✅ Ticket cancelado.';
  } catch (e) { req.session.err = e.message; }
  res.redirect(req.body.volver === 'historial' ? '/historial' : '/operacion');
}));

module.exports = router;
module.exports.SQL_TICKET = SQL_TICKET;
