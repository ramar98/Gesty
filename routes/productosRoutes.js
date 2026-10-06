const express = require("express");

const router = express.Router();

const productosController = require(
    "../controllers/productosController",
);

const {
    autorizarRoles,
} = require(
    "../middlewares/authMiddleware",
);

router.get(
    "/",
    productosController.obtenerProductos,
);

router.get(
    "/:id",
    productosController.obtenerProducto,
);

/*
 * Crear, editar y eliminar productos
 * es exclusivo del Administrador,
 * igual que en el frontend.
 */

router.post(
    "/",
    autorizarRoles(
        "Administrador",
    ),
    productosController.crearProducto,
);

router.put(
    "/:id",
    autorizarRoles(
        "Administrador",
    ),
    productosController.actualizarProducto,
);

router.delete(
    "/:id",
    autorizarRoles(
        "Administrador",
    ),
    productosController.eliminarProducto,
);

module.exports = router;