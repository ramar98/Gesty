const express = require(
  "express",
);

const router =
  express.Router();

const cajaController =
  require(
    "../controllers/cajaController",
  );

const {
  verificarAutenticacion,
} = require(
  "../middlewares/authMiddleware",
);

/*
 * Todas las rutas de caja
 * requieren usuario autenticado.
 */
router.use(
  verificarAutenticacion,
);

/*
 * =====================================
 * CAJA ACTUAL
 * =====================================
 */
router.get(
  "/actual",
  cajaController.obtenerCajaActual,
);

/*
 * =====================================
 * ABRIR CAJA
 * =====================================
 */
router.post(
  "/abrir",
  cajaController.abrirCaja,
);

/*
 * =====================================
 * REGISTRAR MOVIMIENTO
 * =====================================
 */
router.post(
  "/movimientos",
  cajaController.registrarMovimiento,
);

/*
 * =====================================
 * CERRAR CAJA
 * =====================================
 */
router.post(
  "/cerrar",
  cajaController.cerrarCaja,
);

/*
 * =====================================
 * HISTORIAL
 * =====================================
 */
router.get(
  "/historial",
  cajaController.obtenerHistorial,
);

/*
 * =====================================
 * DETALLE DE TURNO
 * =====================================
 *
 * Importante:
 * esta ruta queda al final porque
 * "/:turnoId" podría capturar otras
 * rutas si estuviera antes.
 */
router.get(
  "/:turnoId",
  cajaController.obtenerTurno,
);

module.exports =
  router;