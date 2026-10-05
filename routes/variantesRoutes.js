const express = require("express");

const router = express.Router();

const controller = require(
  "../controllers/variantesController",
);

const {
  verificarAutenticacion,
  autorizarRoles,
} = require(
  "../middlewares/authMiddleware",
);

/*
|--------------------------------------------------------------------------
| Todas las rutas requieren sesión iniciada
|--------------------------------------------------------------------------
*/

router.use(verificarAutenticacion);

/*
|--------------------------------------------------------------------------
| CONSULTAS
|--------------------------------------------------------------------------
| Administrador y Vendedor
*/

router.get(
  "/producto/:producto_id",
  autorizarRoles(
    "ADMINISTRADOR",
    "VENDEDOR",
  ),
  controller.obtenerVariantes,
);

router.get(
  "/codigo/:codigo",
  autorizarRoles(
    "ADMINISTRADOR",
    "VENDEDOR",
  ),
  controller.obtenerVariantePorCodigo,
);

router.get(
  "/:id",
  autorizarRoles(
    "ADMINISTRADOR",
    "VENDEDOR",
  ),
  controller.obtenerVariante,
);

/*
|--------------------------------------------------------------------------
| MODIFICACIONES
|--------------------------------------------------------------------------
| Solo Administrador
*/

router.post(
  "/",
  autorizarRoles(
    "ADMINISTRADOR",
  ),
  controller.crearVariante,
);

router.put(
  "/:id",
  autorizarRoles(
    "ADMINISTRADOR",
  ),
  controller.actualizarVariante,
);

router.delete(
  "/:id",
  autorizarRoles(
    "ADMINISTRADOR",
  ),
  controller.eliminarVariante,
);

module.exports = router;