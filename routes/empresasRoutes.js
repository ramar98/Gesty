const express = require(
  "express",
);

const router =
  express.Router();

const empresasController =
  require(
    "../controllers/empresasController",
  );

/*
 * =====================================
 * ALTA DE NUEVA EMPRESA
 * =====================================
 *
 * Endpoint de onboarding.
 *
 * NO requiere una empresa existente.
 */

router.post(
  "/",
  empresasController.crearEmpresa,
);

router.get("/planes", empresasController.obtenerPlanes);

/*
 * Consulta del estado de un alta
 * pendiente de pago. Si MP ya la
 * acreditó, materializa la empresa.
 */

router.get(
  "/registro/:referencia",
  empresasController.estadoRegistro,
);

module.exports = router;
