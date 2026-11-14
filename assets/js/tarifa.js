// ============================================================
//  tarifa.js — Cálculo del cobro por tiempo
//
//  Este archivo lo usan los dos lados: el servidor (que es quien manda
//  al cobrar) y el navegador (para ir mostrando cuánto lleva cada carro).
//
//  Una sola tarifa para todos los vehículos:
//   • Dentro de la tolerancia no se cobra.
//   • Al pasar la tolerancia se cobra la hora completa (ej. $25).
//   • Después de los 60 minutos el monto sube parejo, minuto a minuto,
//     al ritmo de la tarifa por hora: 25, 26, 27, 28... Se cobra en pesos cerrados.
// ============================================================
(function (root) {
  'use strict';

  function calcularMonto(mins, precioHora, toleranciaMin) {
    mins = Math.max(0, Math.floor(mins || 0));
    var hora = parseFloat(precioHora) || 0;
    if (mins <= (parseInt(toleranciaMin) || 0)) return 0;
    return Math.round(hora + Math.max(0, mins - 60) * (hora / 60));
  }

  function fmtTiempo(mins) {
    mins = Math.max(0, Math.floor(mins || 0));
    var d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return (d ? d + 'd ' : '') + h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
  }

  var api = { calcularMonto: calcularMonto, fmtTiempo: fmtTiempo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.calcularMonto = calcularMonto; root.fmtTiempo = fmtTiempo; }
})(this);
