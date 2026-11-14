# Estacionamiento POS

Punto de venta para un estacionamiento, hecho sobre la misma base que Hotel Real Jilo
(Node.js + Express + EJS + MySQL). Tiene dos roles:

| | Cajero | Administrador |
|---|:-:|:-:|
| Registrar entradas e imprimir ticket | ✅ | ✅ |
| Cobrar salidas (efectivo con cambio, tarjeta, transferencia, boleto perdido) | ✅ | ✅ |
| Abrir y cerrar caja, registrar gastos, imprimir corte | ✅ | ✅ |
| Cobrar mensualidades de pensión | ✅ | ✅ |
| Ver cortes de días anteriores | — | ✅ |
| Retirar efectivo, anular movimientos, cancelar tickets | — | ✅ |
| Alta y edición de pensiones | — | ✅ |
| Dashboard, historial y exportar a Excel | — | ✅ |
| Tarifas, usuarios y configuración | — | ✅ |

## Arrancar

1. Tener MySQL encendido (XAMPP o el servicio de Windows).
2. `INSTALAR.bat` la primera vez (instala dependencias y crea `.env`).
3. Poner en `.env` el usuario y la contraseña de MySQL. La base `estacionamiento` se crea sola.
4. `INICIAR.bat` y abrir <http://localhost:3002>.

La primera vez se crean dos usuarios: un administrador y un cajero. Sus nombres y contraseñas
iniciales son los de `ADMIN_*` y `CAJERO_*` en `.env` (ver `.env.example`). **Cámbialas al entrar**
(menú de arriba a la derecha → *Cambiar mi contraseña*, o desde *Usuarios*).

## Cómo se cobra

Hay **una sola tarifa para todos los vehículos** (se cambia en *Tarifa*, por defecto $25 la hora):

- **Tolerancia**: si sale dentro de esos minutos no paga.
- **Primera hora**: se cobra completa ($25).
- **Después, por minuto**: a partir del minuto 61 el monto sube con el tiempo al mismo precio
  por hora, en pesos cerrados: 25, 26, 27, 28… (2 h = $50, 3 h = $75).
- **Boleto perdido**: cargo extra que se suma al tiempo.

En la entrada solo las **placas** son obligatorias; el nombre es opcional. El tipo de vehículo
solo sirve para identificarlo, no cambia el precio.

El cálculo vive en un solo archivo, `assets/js/tarifa.js`, que usan el servidor y el navegador.
Al abrir la pantalla de cobro el monto queda guardado en el servidor durante 5 minutos: lo que
ve el cajero es exactamente lo que se cobra.

## Estructura

```
app.js              arranque y rutas
config/app.js       configuración (lee .env)
lib/migrate.js      crea/actualiza las tablas al arrancar
lib/settings.js     configuración editable (nombre, capacidad, tolerancia…)
middleware/auth.js  sesión y roles
routes/             operacion, caja, pensiones, dashboard, historial, tarifas, usuarios, configuracion
views/              pantallas (EJS)
assets/             estilos, scripts y logo
```
