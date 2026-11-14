// Envuelve un route handler async para que los errores
// lleguen al error handler de Express en vez de colapsar el proceso.
module.exports = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
