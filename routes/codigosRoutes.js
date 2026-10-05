const express = require("express");

const router = express.Router();

const controller = require(
  "../controllers/codigosController",
);

const {
  verificarAutenticacion,
  autorizarRoles,
} = require(
  "../middlewares/authMiddleware",
);

/*
|--------------------------------------------------------------------------
| VALIDACIÓN PÚBLICA
|
| Solo informa qué otorga el código;
| no consume usos.
|--------------------------------------------------------------------------
*/

router.post(
  "/validar",
  controller.validar,
);

/*
|--------------------------------------------------------------------------
| SUPERADMIN — gestión de códigos
|--------------------------------------------------------------------------
*/

router.use(
  verificarAutenticacion,
  autorizarRoles("SUPERADMIN"),
);

router.get("/", controller.listar);

router.post("/", controller.crear);

router.patch(
  "/:id/desactivar",
  controller.desactivar,
);

module.exports = router;
