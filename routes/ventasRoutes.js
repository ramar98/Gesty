const express = require(
  "express",
);

const router =
  express.Router();

const ventasController =
  require(
    "../controllers/ventasController",
  );

const {
  verificarAutenticacion,
  autorizarRoles,
} = require(
  "../middlewares/authMiddleware",
);

/*
 * Todas las rutas de ventas
 * requieren usuario autenticado.
 */
router.use(
  verificarAutenticacion,
);

/*
 * =====================================
 * LISTADO
 * =====================================
 */
router.get(
  "/",
  ventasController.obtenerVentas,
);

/*
 * =====================================
 * DETALLE
 * =====================================
 */
router.get(
  "/:id",
  ventasController.obtenerVenta,
);

/*
 * =====================================
 * CREAR
 * =====================================
 */
router.post(
  "/",
  ventasController.crearVenta,
);

/*
 * =====================================
 * ANULAR
 * =====================================
 */
router.patch(
  "/:id/anular",
  autorizarRoles(
    "Administrador",
  ),
  ventasController.anularVenta,
);

module.exports =
  router;