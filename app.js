'use strict';

// Hora de México para todo el proceso (fechas, turnos, reportes)
process.env.TZ = process.env.TZ || 'America/Mexico_City';

const express     = require('express');
const session     = require('express-session');
const MySQLStore  = require('express-mysql-session')(session);
const helmet      = require('helmet');
const compression = require('compression');
const path        = require('path');
const cfg         = require('./config/app');
const auth        = require('./middleware/auth');
const { pool, ensureDatabase, dbQuery } = require('./lib/db');
const { migrate } = require('./lib/migrate');
const settings    = require('./lib/settings');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: cfg.IS_PROD ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false }); }
});

// ── Sesiones guardadas en MySQL (sobreviven reinicios) ────────
const sessionStore = new MySQLStore({
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: cfg.SESSION_MAX_AGE,
}, pool);

app.use(session({
  name:              'est.sid',
  secret:            cfg.SESSION_SECRET,
  store:             sessionStore,
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure:   cfg.IS_PROD && process.env.COOKIE_SECURE !== 'false' ? 'auto' : false,
    maxAge:   cfg.SESSION_MAX_AGE,
  },
}));

// ── Variables disponibles en todas las vistas ─────────────────
app.use(async (req, res, next) => {
  let conf = settings.DEFAULTS;
  try { conf = await settings.getAll(); } catch {}
  res.locals.CONF         = conf;
  res.locals.APP_NAME     = conf.negocio_nombre || cfg.APP_NAME;
  res.locals.APP_VER      = cfg.APP_VER;
  res.locals.user         = req.session.user || null;
  res.locals.ROL_ADMIN    = cfg.ROL_ADMIN;
  res.locals.ROL_CAJERO   = cfg.ROL_CAJERO;
  res.locals.turnoActual  = auth.turnoActual();
  res.locals.paginaActiva = '';
  res.locals.titulo       = res.locals.APP_NAME;
  res.locals.helpers      = require('./lib/helpers');
  res.locals.fmtTiempo    = require('./assets/js/tarifa').fmtTiempo;
  res.locals.msg = req.session.msg || ''; delete req.session.msg;
  res.locals.err = req.session.err || ''; delete req.session.err;
  res.locals.sesionCaja = null;
  res.locals.avisosPension = [];
  if (req.session.user && req.method === 'GET') {
    try { res.locals.sesionCaja = await auth.sesionCajaActiva(); } catch {}
    // Avisos: pensiones vencidas o por vencer (campanita y pantalla de entradas)
    try {
      res.locals.avisosPension = await dbQuery(`SELECT id_pension, cliente, placas, telefono, vence, DATEDIFF(vence, CURDATE()) AS dias
        FROM PENSIONES WHERE activo=1 AND vence <= DATE_ADD(CURDATE(), INTERVAL ? DAY) ORDER BY vence LIMIT 50`,
        [parseInt(conf.pension_aviso_dias) || 0]);
    } catch {}
  }
  next();
});

app.get('/api/hora', (req, res) => res.json({ epoch: Date.now() }));

app.use('/',              require('./routes/index'));
app.use('/operacion',     require('./routes/operacion'));
app.use('/caja',          require('./routes/caja'));
app.use('/pensiones',     require('./routes/pensiones'));
app.use('/dashboard',     require('./routes/dashboard'));
app.use('/historial',     require('./routes/historial'));
app.use('/tarifas',       require('./routes/tarifas'));
app.use('/usuarios',      require('./routes/usuarios'));
app.use('/configuracion', require('./routes/configuracion'));

app.use((req, res) => {
  res.status(404).render('error', { codigo: 404, mensaje: 'Página no encontrada' });
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', new Date().toLocaleString('es-MX'), req.method, req.originalUrl, '-', err.message);
  const detalle = cfg.IS_PROD ? '' : (err.code || '') + ' ' + err.message;
  res.status(500).render('error', { codigo: 500, mensaje: 'Ocurrió un error inesperado.', detalle });
});

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

async function startServer() {
  try {
    await ensureDatabase();
    const conn = await pool.getConnection();
    conn.release();
    console.log('  [DB] Conexión a MySQL: OK (' + cfg.DB_HOST + '/' + cfg.DB_DATABASE + ')');
  } catch (e) {
    console.error('\n  ERROR: No se puede conectar a MySQL');
    console.error('  Código:  ' + e.code);
    console.error('  Mensaje: ' + e.message);
    console.error('\n  Revisa DB_HOST, DB_USER, DB_PASSWORD y DB_DATABASE en el archivo .env\n');
    process.exit(1);
  }

  try {
    await migrate();
    console.log('  [DB] Estructura de la base de datos al día.');
  } catch (e) {
    console.error('  [DB] Error al actualizar la estructura:', e.message);
    process.exit(1);
  }

  app.listen(cfg.PORT, () => {
    console.log('\n  ' + cfg.APP_NAME + ' POS v' + cfg.APP_VER + ' corriendo en http://localhost:' + cfg.PORT);
    console.log('  Presiona Ctrl+C para detener.\n');
  });
}

if (require.main === module) startServer();

module.exports = app;
