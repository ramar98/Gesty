const ventasService = require(
  "../services/ventasService",
);

const METODOS_PAGO = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "TARJETA",
  "OTRO",
];

function convertirId(valor) {
  const id = Number(valor);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

function obtenerEmpresaId(req) {
  const empresaId = Number(
    req.empresaId ??
    req.usuario?.empresa_id,
  );

  if (
    !Number.isInteger(empresaId) ||
    empresaId <= 0
  ) {
    return null;
  }

  return empresaId;
}

function normalizarRol(valor) {
  return String(
    valor ?? "",
  )
    .trim()
    .toUpperCase();
}

function esAdministrador(req) {
  return (
    normalizarRol(
      req.usuario?.rol,
    ) === "ADMINISTRADOR"
  );
}

function validarFecha(valor) {
  if (!valor) {
    return true;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(
    valor,
  );
}

function validarProductos(
  productos,
) {
  const errores = [];

  if (
    !Array.isArray(productos) ||
    productos.length === 0
  ) {
    errores.push(
      "La venta debe tener al menos un producto.",
    );

    return errores;
  }

  const variantesUsadas =
    new Set();

  productos.forEach(
    (
      item,
      indice,
    ) => {
      const numero =
        indice + 1;

      const varianteId =
        convertirId(
          item.variante_id,
        );

      const cantidad =
        Number(
          item.cantidad,
        );

      const precioUnitario =
        Number(
          item.precio_unitario,
        );

      if (!varianteId) {
        errores.push(
          `La variante del producto ${numero} no es válida.`,
        );
      }

      if (
        !Number.isFinite(
          cantidad,
        ) ||
        cantidad <= 0
      ) {
        errores.push(
          `La cantidad del producto ${numero} debe ser mayor que cero.`,
        );
      }

      if (
        item.precio_unitario ===
        undefined ||
        item.precio_unitario ===
        "" ||
        Number.isNaN(
          precioUnitario,
        ) ||
        precioUnitario < 0
      ) {
        errores.push(
          `El precio del producto ${numero} no es válido.`,
        );
      }

      if (
        varianteId &&
        variantesUsadas.has(
          varianteId,
        )
      ) {
        errores.push(
          `La variante del producto ${numero} está repetida.`,
        );
      }

      if (varianteId) {
        variantesUsadas.add(
          varianteId,
        );
      }
    },
  );

  return errores;
}

function validarVenta(
  body = {},
) {
  const errores = [];

  let clienteId = null;

  if (
    body.cliente_id !==
    undefined &&
    body.cliente_id !==
    null &&
    body.cliente_id !== ""
  ) {
    clienteId =
      convertirId(
        body.cliente_id,
      );

    if (!clienteId) {
      errores.push(
        "El cliente seleccionado no es válido.",
      );
    }
  }

  const descuento =
    Number(
      body.descuento ?? 0,
    );

  if (
    Number.isNaN(
      descuento,
    ) ||
    descuento < 0
  ) {
    errores.push(
      "El descuento no es válido.",
    );
  }

  const metodoPago =
    String(
      body.metodo_pago ?? "",
    )
      .trim()
      .toUpperCase();

  if (
    !METODOS_PAGO.includes(
      metodoPago,
    )
  ) {
    errores.push(
      "El método de pago no es válido.",
    );
  }

  const erroresProductos =
    validarProductos(
      body.productos,
    );

  errores.push(
    ...erroresProductos,
  );

  return {
    valido:
      errores.length === 0,

    errores,

    datos: {
      cliente_id:
        clienteId,

      descuento,

      metodo_pago:
        metodoPago,

      productos:
        Array.isArray(
          body.productos,
        )
          ? body.productos.map(
            (item) => ({
              variante_id:
                Number(
                  item.variante_id,
                ),

              cantidad:
                Number(
                  item.cantidad,
                ),

              precio_unitario:
                Number(
                  item.precio_unitario,
                ),
            }),
          )
          : [],
    },
  };
}

function responderEmpresaNoValida(
  res,
) {
  return res
    .status(403)
    .json({
      success: false,

      message:
        "No se pudo determinar la empresa del usuario autenticado.",

      error: {
        code:
          "EMPRESA_NO_ASIGNADA",
      },
    });
}

function responderError(
  res,
  error,
) {
  if (
    error.code ===
    "CLIENTE_NO_ENCONTRADO"
  ) {
    return res
      .status(404)
      .json({
        success: false,

        message:
          "El cliente seleccionado no existe o no pertenece a la empresa.",

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "USUARIO_NO_ENCONTRADO"
  ) {
    return res
      .status(404)
      .json({
        success: false,

        message:
          "El usuario seleccionado no existe, está inactivo o no pertenece a la empresa.",

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "VARIANTE_NO_ENCONTRADA"
  ) {
    return res
      .status(404)
      .json({
        success: false,

        message:
          error.message,

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "STOCK_INSUFICIENTE"
  ) {
    return res
      .status(409)
      .json({
        success: false,

        message:
          error.message,

        error: {
          code:
            error.code,

          variante_id:
            error.varianteId,

          stock_disponible:
            error.stockDisponible,
        },
      });
  }

  if (
    error.code ===
    "ER_NO_REFERENCED_ROW_2"
  ) {
    return res
      .status(400)
      .json({
        success: false,

        message:
          "Uno de los datos relacionados de la venta no existe.",

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "VENTA_NO_ENCONTRADA"
  ) {
    return res
      .status(404)
      .json({
        success: false,

        message:
          "Venta no encontrada.",

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "VENTA_YA_ANULADA"
  ) {
    return res
      .status(409)
      .json({
        success: false,

        message:
          "La venta ya se encuentra anulada.",

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "VENTA_NO_ANULABLE" ||
    error.code ===
    "VENTA_SIN_DETALLE" ||
    error.code ===
    "CANTIDAD_VENTA_INVALIDA"
  ) {
    return res
      .status(409)
      .json({
        success: false,

        message:
          error.message,

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "CAJA_CERRADA"
  ) {
    return res
      .status(409)
      .json({
        success: false,

        message:
          "No hay una caja abierta. Abrí la caja antes de registrar una venta.",

        error: {
          code:
            error.code,
        },
      });
  }

  if (
    error.code ===
    "CAJA_NO_ENCONTRADA"
  ) {
    return res
      .status(404)
      .json({
        success: false,

        message:
          "No se encontró una caja activa para la empresa.",

        error: {
          code:
            error.code,
        },
      });
  }

  console.error(
    "Error procesando venta:",
    error,
  );

  return res
    .status(500)
    .json({
      success: false,

      message:
        "Ocurrió un error interno procesando la venta.",

      error:
        process.env.NODE_ENV ===
          "development"
          ? {
            code:
              error.code,

            detail:
              error.message,
          }
          : undefined,
    });
}

/*
 * =====================================
 * LISTADO
 * =====================================
 */

exports.obtenerVentas =
  async (
    req,
    res,
  ) => {
    const empresaId =
      obtenerEmpresaId(req);

    if (!empresaId) {
      return responderEmpresaNoValida(
        res,
      );
    }

    const {
      fecha_desde:
      fechaDesde = null,

      fecha_hasta:
      fechaHasta = null,

      cliente_id:
      clienteIdRaw = null,

      metodo_pago:
      metodoPagoRaw = null,
    } = req.query;

    if (
      fechaDesde &&
      !validarFecha(
        fechaDesde,
      )
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "La fecha desde no es válida.",
        });
    }

    if (
      fechaHasta &&
      !validarFecha(
        fechaHasta,
      )
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "La fecha hasta no es válida.",
        });
    }

    if (
      fechaDesde &&
      fechaHasta &&
      fechaDesde >
      fechaHasta
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "La fecha desde no puede ser posterior a la fecha hasta.",
        });
    }

    let clienteId =
      null;

    if (clienteIdRaw) {
      clienteId =
        convertirId(
          clienteIdRaw,
        );

      if (!clienteId) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "El cliente seleccionado no es válido.",
          });
      }
    }

    const metodoPago =
      metodoPagoRaw
        ? String(
          metodoPagoRaw,
        )
          .trim()
          .toUpperCase()
        : null;

    if (
      metodoPago &&
      !METODOS_PAGO.includes(
        metodoPago,
      )
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "El método de pago no es válido.",
        });
    }

    try {
      const ventas =
        await ventasService.obtenerVentas({
          empresaId,
          fechaDesde,
          fechaHasta,
          clienteId,
          metodoPago,
        });

      return res
        .status(200)
        .json({
          success: true,
          data: ventas,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * =====================================
 * DETALLE
 * =====================================
 */

exports.obtenerVenta =
  async (
    req,
    res,
  ) => {
    const id =
      convertirId(
        req.params.id,
      );

    if (!id) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "El ID de la venta no es válido.",
        });
    }

    const empresaId =
      obtenerEmpresaId(req);

    if (!empresaId) {
      return responderEmpresaNoValida(
        res,
      );
    }

    try {
      const venta =
        await ventasService.obtenerVentaPorId(
          id,
          empresaId,
        );

      if (!venta) {
        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Venta no encontrada.",
          });
      }

      return res
        .status(200)
        .json({
          success: true,
          data: venta,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * =====================================
 * CREAR
 * =====================================
 */

exports.crearVenta =
  async (
    req,
    res,
  ) => {
    const empresaId =
      obtenerEmpresaId(req);

    if (!empresaId) {
      return responderEmpresaNoValida(
        res,
      );
    }

    const validacion =
      validarVenta(
        req.body,
      );

    if (
      !validacion.valido
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "Los datos de la venta no son válidos.",

          errors:
            validacion.errores,
        });
    }

    const usuarioId =
      req.usuario?.id ??
      req.usuarioId ??
      null;

    if (!usuarioId) {
      return res
        .status(401)
        .json({
          success: false,

          message:
            "No se pudo identificar al usuario de la sesión.",

          error: {
            code:
              "USUARIO_NO_AUTENTICADO",
          },
        });
    }

    const datosVenta = {
      ...validacion.datos,

      empresa_id:
        empresaId,

      usuario_id:
        Number(
          usuarioId,
        ),
    };

    try {
      const venta =
        await ventasService.crearVenta(
          datosVenta,
        );

      return res
        .status(201)
        .json({
          success: true,

          message:
            "Venta registrada correctamente.",

          data:
            venta,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * =====================================
 * ANULAR VENTA
 * =====================================
 */

exports.anularVenta =
  async (
    req,
    res,
  ) => {
    const id =
      convertirId(
        req.params.id,
      );

    if (!id) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "El ID de la venta no es válido.",
        });
    }

    const empresaId =
      obtenerEmpresaId(req);

    if (!empresaId) {
      return responderEmpresaNoValida(
        res,
      );
    }

    if (!esAdministrador(req)) {
      return res
        .status(403)
        .json({
          success: false,

          message:
            "No tenés permisos para anular ventas.",

          error: {
            code:
              "PERMISO_DENEGADO",
          },
        });
    }

    const usuarioId =
      convertirId(
        req.usuario?.id ??
        req.usuarioId,
      );

    if (!usuarioId) {
      return res
        .status(401)
        .json({
          success: false,

          message:
            "No se pudo identificar al usuario de la sesión.",

          error: {
            code:
              "USUARIO_NO_AUTENTICADO",
          },
        });
    }

    const motivo =
      String(
        req.body?.motivo ??
        "",
      ).trim();

    if (!motivo) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "El motivo de la anulación es obligatorio.",
        });
    }

    if (
      motivo.length >
      500
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "El motivo de la anulación no puede superar los 500 caracteres.",
        });
    }

    try {
      const venta =
        await ventasService.anularVenta({
          id,
          empresaId,
          usuarioId,
          motivo,
        });

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Venta anulada correctamente. El stock fue restituido.",

          data:
            venta,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };