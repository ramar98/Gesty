const express = require("express");

const router = express.Router();

const controller = require(
  "../controllers/suscripcionController",
);

const {
  verificarAutenticacion,
  autorizarRoles,
} = require(
  "../middlewares/authMiddleware",
);

/*
|--------------------------------------------------------------------------
| WEBHOOK MERCADO PAGO
|
| Público: lo llama el servidor de MP.
| La seguridad la da la firma HMAC.
|--------------------------------------------------------------------------
*/

router.post(
  "/webhook",
  controller.webhook,
);

/*
|--------------------------------------------------------------------------
| A PARTIR DE ACÁ REQUIEREN SESIÓN
| (pero NO suscripción activa: si estás
| vencido justamente venís a pagar)
|--------------------------------------------------------------------------
*/

router.use(verificarAutenticacion);

router.get(
  "/estado",
  controller.obtenerEstado,
);

/*
|--------------------------------------------------------------------------
| PAGOS Y CANJE — Solo Administrador
|--------------------------------------------------------------------------
*/

router.post(
  "/pagos",
  autorizarRoles(
    "ADMINISTRADOR",
  ),
  controller.crearPago,
);

router.post(
  "/codigo",
  autorizarRoles(
    "ADMINISTRADOR",
  ),
  controller.canjearCodigo,
);

/*
|--------------------------------------------------------------------------
| SUPERADMIN — gestión de la plataforma
|--------------------------------------------------------------------------
*/

router.get(
  "/empresas",
  autorizarRoles(
    "SUPERADMIN",
  ),
  controller.listarEmpresas,
);

router.post(
  "/empresas/:id/extender",
  autorizarRoles(
    "SUPERADMIN",
  ),
  controller.extenderEmpresa,
);

module.exports = router;
