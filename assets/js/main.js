// ============================================================
//  assets/js/main.js  — Estacionamiento POS
// ============================================================

// ── Reloj en topbar ──────────────────────────────────────────
// Siempre marca la hora del SERVIDOR (la misma que se guarda en la base),
// aunque el reloj de la computadora esté mal. Se corrige en cada carga.
const RJ_TZ = 'America/Mexico_City';
let RJ_DELTA = 0;   // milisegundos de diferencia entre el servidor y esta PC

function rjAhora() { return new Date(Date.now() + RJ_DELTA); }

function rjPintarReloj() {
  const el = document.getElementById('reloj');
  if (!el) return;
  el.textContent = rjAhora().toLocaleString('es-MX', {
    timeZone: RJ_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('reloj');
  const srv = el && parseInt(el.dataset.server, 10);
  if (srv) RJ_DELTA = srv - Date.now();
  rjPintarReloj();
  setInterval(rjPintarReloj, 1000);
  // Cada 5 minutos se vuelve a sincronizar con el servidor
  setInterval(rjSincronizar, 300000);
  // Al volver a la pestaña también se resincroniza
  document.addEventListener('visibilitychange', () => { if (!document.hidden) rjSincronizar(); });
});

async function rjSincronizar() {
  try {
    const t0 = Date.now();
    const r = await fetch('/api/hora', { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    const viaje = (Date.now() - t0) / 2;          // compensa la ida y vuelta
    RJ_DELTA = (d.epoch + viaje) - Date.now();
    rjPintarReloj();
  } catch {}
}

// ── Toggle sidebar ────────────────────────────────────────────
function toggleSidebar() {
  const s = document.getElementById('sidebar');
  s.classList.toggle('collapsed');
  localStorage.setItem('sidebar', s.classList.contains('collapsed') ? '1' : '0');
}
document.addEventListener('DOMContentLoaded', () => {
  try { if (localStorage.getItem('sidebar') === '1') document.getElementById('sidebar')?.classList.add('collapsed'); } catch {}
});

// ── Auto-cerrar alertas ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.alert').forEach(a => {
    setTimeout(() => {
      a.style.transition = 'opacity .4s, transform .4s';
      a.style.opacity = '0';
      a.style.transform = 'translateY(-8px)';
      setTimeout(() => a.remove(), 400);
    }, 5000);
  });
});

// ── Modal helpers ─────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ── TABS — CORRECCIÓN BUG CRÍTICO ────────────────────────────
// BUG: el selector '.tab-pane[data-group]' nunca encontraba nada
// porque los paneles no tienen la clase 'tab-pane'.
// FIX: usar '[data-group]:not(.tabs):not(.tab)' para encontrar paneles.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      const group = t.closest('.tabs')?.dataset.group;
      if (!group) return;
      document.querySelectorAll(`.tab[data-group="${group}"]`)
        .forEach(x => x.classList.remove('active'));
      // FIX: buscar paneles correctamente (excluir .tabs y .tab)
      document.querySelectorAll(`[data-group="${group}"]:not(.tabs):not(.tab)`)
        .forEach(x => { x.style.display = 'none'; });
      t.classList.add('active');
      const pane = document.getElementById(t.dataset.target);
      if (pane) pane.style.display = 'block';
    });
  });
});

// ── Formatear moneda MXN ──────────────────────────────────────
function mxn(n) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

// ── Alerta dinámica (toast) ───────────────────────────────────
function showAlert(msg, tipo = 'success') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const div = document.createElement('div');
  div.className = `alert alert-${tipo}`;
  div.innerHTML = `<span>${icons[tipo] || ''}</span> ${msg}`;
  document.querySelector('.content')?.prepend(div);
  setTimeout(() => {
    div.style.transition = 'opacity .4s, transform .4s';
    div.style.opacity = '0';
    div.style.transform = 'translateY(-8px)';
    setTimeout(() => div.remove(), 400);
  }, 4500);
}

// ── Confirmar acción ──────────────────────────────────────────
function confirmar(msg) { return confirm(msg); }

// ── v3: dropdowns (campanita / usuario) ───────────────────────
function toggleDD(id) {
  const el = document.getElementById(id);
  const abierto = el.classList.contains('open');
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  if (!abierto) el.classList.add('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.dropdown')) document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
});

// En celular el botón ☰ despliega el menú completo
if (window.matchMedia('(max-width:768px)').matches) {
  window.toggleSidebar = function () { document.body.classList.toggle('nav-open'); };
}

// ── Abrir pestaña indicada en la URL (?tab=xxx) ───────────────
document.addEventListener('DOMContentLoaded', () => {
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab) document.querySelector(`.tab[data-target="${tab}"]`)?.click();
});

// ── Filtro rápido de tablas: <input data-filtro="idTabla"> ────
document.addEventListener('input', e => {
  const id = e.target.dataset?.filtro;
  if (!id) return;
  const q = e.target.value.toLowerCase();
  document.querySelectorAll(`#${id} tbody tr`).forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// ── Gráficas: estilo común ────────────────────────────────────
const RJ_COLORS = ['#0ea5e9', '#f9735b', '#075985', '#7dd3fc', '#fbbf24', '#0f9f6e', '#fda4af', '#0d9488', '#38bdf8', '#64748b'];
function rjChart(id, type, labels, datasets, opts = {}) {
  const run = () => {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    Chart.defaults.color = '#5d6784';
    Chart.defaults.borderColor = 'rgba(7,89,133,.10)';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    const isPie = type === 'doughnut' || type === 'pie';
    datasets.forEach((d, i) => {
      if (isPie) { d.backgroundColor = d.backgroundColor || RJ_COLORS; d.borderWidth = 0; }
      else {
        const c = d.color || RJ_COLORS[i % RJ_COLORS.length];
        d.borderColor = d.borderColor || c;
        d.backgroundColor = d.backgroundColor || (type === 'line' ? c + '1f' : c + 'd9');
        if (type === 'line') { d.tension = .35; d.fill = d.fill ?? true; d.pointRadius = 2; }
        if (type === 'bar') d.borderRadius = 6;
      }
    });
    return new Chart(el, {
      type, data: { labels, datasets },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: isPie || datasets.length > 1, position: isPie ? 'right' : 'top', labels: { boxWidth: 12 } } },
        scales: isPie ? {} : { y: {
          beginAtZero: true,
          max: opts.max,
          ticks: { callback: opts.money ? (v => '$' + Number(v).toLocaleString('es-MX'))
                          : (opts.max === 100 ? (v => v + '%') : undefined) },
        } },
      }, opts.options || {}),
    });
  };
  if (window.Chart) run(); else window.addEventListener('load', run);
}
