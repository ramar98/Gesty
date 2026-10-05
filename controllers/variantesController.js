const variantesService = require(
  "../services/variantesService",
);

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
  const empresaId =
    Number(
      req.empresaId ??
        req.usuario?.empresa_id,
    );

  if (
    !Number.isInteger(
      empresaId,
    ) ||
    empresaId <= 0
  ) {
    return null;
  }

  return empresaId;
}

function normalizarTextoOpcional(
  valor,
) {
  if (
    valor === undefined ||
    valor === null ||
    valor === ""
  ) {
    return null;
  }

  return (
    String(valor).trim() ||
    null
  );
}

function normalizarRol(rol) {
  return String(
    rol ?? "",
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

/*
 * ===================================
 * FILTRADO SEGÚN ROL
 * ===================================
 */

function filtrarVariantePorRol(
  variante,
  administrador,
) {
  if (!variante) {
    return variante;
  }

  if (administrador) {
    return variante;
  }

  const varianteSegura = {
    ...variante,
  };

  delete varianteSegura.precio_costo;
  delete varianteSegura.margen;

  return varianteSegura;
}

function filtrarVariantesPorRol(
  variantes,
  administrador,
) {
  if (
    !Array.isArray(
      variantes,
    )
  ) {
    return [];
  }

  return variantes.map(
    (variante) =>
      filtrarVariantePorRol(
        variante,
        administrador,
      ),
  );
}

/*
 * ===================================
 * PROTECCIÓN ADMINISTRADOR
 * ===================================
 */

function verificarAdministrador(
  req,
  res,
) {
  if (
    esAdministrador(req)
  ) {
    return true;
  }

  res
    .status(403)
    .json({
      success: false,

      message:
        "No tenés permisos para realizar esta operación.",

      error: {
        code:
          "PERMISO_DENEGADO",
      },
    });

  return false;
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

/*
 * ===================================
 * VALIDACIÓN
 * ===================================
 */

function validarVariante(
  body = {},
  {
    creando = false,
  } = {},
) {
  const errores = [];

  const productoId =
    convertirId(
      body.producto_id,
    );

  const colorId =
    convertirId(
      body.color_id,
    );

  const talleId =
    convertirId(
      body.talle_id,
    );

  const precioCosto =
    Number(
      body.precio_costo,
    );

  const precioVenta =
    Number(
      body.precio_venta,
    );

  const stockActual =
    Number(
      body.stock_actual ??
        0,
    );

  const stockMinimo =
    Number(
      body.stock_minimo ??
        1,
    );

  if (
    creando &&
    !productoId
  ) {
    errores.push(
      "El producto seleccionado no es válido.",
    );
  }

  if (!colorId) {
    errores.push(
      "El color seleccionado no es válido.",
    );
  }

  if (!talleId) {
    errores.push(
      "El talle seleccionado no es válido.",
    );
  }

  if (
    body.precio_costo ===
      undefined ||
    body.precio_costo ===
      "" ||
    Number.isNaN(
      precioCosto,
    ) ||
    precioCosto < 0
  ) {
    errores.push(
      "El precio de costo no es válido.",
    );
  }

  if (
    body.precio_venta ===
      undefined ||
    body.precio_venta ===
      "" ||
    Number.isNaN(
      precioVenta,
    ) ||
    precioVenta < 0
  ) {
    errores.push(
      "El precio de venta no es válido.",
    );
  }

  if (
    creando &&
    (
      !Number.isInteger(
        stockActual,
      ) ||
      stockActual < 0
    )
  ) {
    errores.push(
      "El stock inicial no es válido.",
    );
  }

  if (
    !Number.isInteger(
      stockMinimo,
    ) ||
    stockMinimo < 0
  ) {
    errores.push(
      "El stock mínimo no es válido.",
    );
  }

  const codigoBarras =
    normalizarTextoOpcional(
      body.codigo_barras,
    );

  if (
    codigoBarras &&
    codigoBarras.length >
      100
  ) {
    errores.push(
      "El código de barras no puede superar los 100 caracteres.",
    );
  }

  return {
    valido:
      errores.length === 0,

    errores,

    datos: {
      producto_id:
        productoId,

      color_id:
        colorId,

      talle_id:
        talleId,

      codigo_barras:
        codigoBarras,

      precio_costo:
        precioCosto,

      precio_venta:
        precioVenta,

      stock_actual:
        stockActual,

      stock_minimo:
        stockMinimo,
    },
  };
}

/*
 * ===================================
 * ERRORES
 * ===================================
 */

function responderError(
  res,
  error,
) {
  if (
    error.code ===
    "VARIANTE_DUPLICADA"
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
      "PRODUCTO_NO_ENCONTRADO" ||
    error.code ===
      "COLOR_NO_ENCONTRADO" ||
    error.code ===
      "TALLE_NO_ENCONTRADO"
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
    "ER_DUP_ENTRY"
  ) {
    return res
      .status(409)
      .json({
        success: false,

        message:
          "El código de barras ya está registrado en otra variante.",

        error: {
          code:
            error.code,
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
          "El producto, color o talle seleccionado no existe.",

        error: {
          code:
            error.code,
        },
      });
  }

  console.error(
    "Error procesando variante:",
    error,
  );

  return res
    .status(500)
    .json({
      success: false,

      message:
        "Ocurrió un error interno procesando la variante.",

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
 * ===================================
 * GET VARIANTES POR PRODUCTO
 * ===================================
 */

exports.obtenerVariantes =
  async (
    req,
    res,
  ) => {
    const productoId =
      convertirId(
        req.params.producto_id,
      );

    if (!productoId) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "El ID del producto no es válido.",
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
      const variantes =
        await variantesService.obtenerVariantes(
          productoId,
          empresaId,
        );

      const administrador =
        esAdministrador(req);

      const variantesFiltradas =
        filtrarVariantesPorRol(
          variantes,
          administrador,
        );

      return res
        .status(200)
        .json({
          success: true,

          data:
            variantesFiltradas,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * ===================================
 * GET VARIANTE POR ID
 * ===================================
 */

exports.obtenerVariante =
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
            "El ID de la variante no es válido.",
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
      const variante =
        await variantesService.obtenerVariantePorId(
          id,
          empresaId,
        );

      if (!variante) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Variante no encontrada.",
          });
      }

      const administrador =
        esAdministrador(req);

      const varianteFiltrada =
        filtrarVariantePorRol(
          variante,
          administrador,
        );

      return res
        .status(200)
        .json({
          success: true,

          data:
            varianteFiltrada,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * ===================================
 * GET VARIANTE POR CÓDIGO DE BARRAS
 * ===================================
 */

exports.obtenerVariantePorCodigo =
  async (
    req,
    res,
  ) => {
    const codigo =
      normalizarTextoOpcional(
        req.params.codigo,
      );

    if (!codigo) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "El código de barras no es válido.",
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
      const resultado =
        await variantesService.obtenerVariantePorCodigo(
          codigo,
          empresaId,
        );

      if (!resultado) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Variante no encontrada.",
          });
      }

      const administrador =
        esAdministrador(req);

      const varianteFiltrada =
        filtrarVariantePorRol(
          resultado.variante,
          administrador,
        );

      return res
        .status(200)
        .json({
          success: true,

          data: {
            variante:
              varianteFiltrada,

            producto:
              resultado.producto,
          },
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * ===================================
 * CREAR
 * SOLO ADMINISTRADOR
 * ===================================
 */

exports.crearVariante =
  async (
    req,
    res,
  ) => {
    if (
      !verificarAdministrador(
        req,
        res,
      )
    ) {
      return;
    }

    const empresaId =
      obtenerEmpresaId(req);

    if (!empresaId) {
      return responderEmpresaNoValida(
        res,
      );
    }

    const validacion =
      validarVariante(
        req.body,
        {
          creando: true,
        },
      );

    if (
      !validacion.valido
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "Los datos de la variante no son válidos.",

          errors:
            validacion.errores,
        });
    }

    try {
      const variante =
        await variantesService.crearVariante(
          validacion.datos,
          empresaId,
        );

      return res
        .status(201)
        .json({
          success: true,

          message:
            "Variante creada correctamente.",

          data:
            variante,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * ===================================
 * ACTUALIZAR
 * SOLO ADMINISTRADOR
 * ===================================
 */

exports.actualizarVariante =
  async (
    req,
    res,
  ) => {
    if (
      !verificarAdministrador(
        req,
        res,
      )
    ) {
      return;
    }

    const empresaId =
      obtenerEmpresaId(req);

    if (!empresaId) {
      return responderEmpresaNoValida(
        res,
      );
    }

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
            "El ID de la variante no es válido.",
        });
    }

    const validacion =
      validarVariante(
        req.body,
        {
          creando: false,
        },
      );

    if (
      !validacion.valido
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "Los datos de la variante no son válidos.",

          errors:
            validacion.errores,
        });
    }

    try {
      const variante =
        await variantesService.actualizarVariante(
          id,
          validacion.datos,
          empresaId,
        );

      if (!variante) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Variante no encontrada.",
          });
      }

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Variante actualizada correctamente.",

          data:
            variante,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * ===================================
 * ELIMINAR
 * SOLO ADMINISTRADOR
 * ===================================
 */

exports.eliminarVariante =
  async (
    req,
    res,
  ) => {
    if (
      !verificarAdministrador(
        req,
        res,
      )
    ) {
      return;
    }

    const empresaId =
      obtenerEmpresaId(req);

    if (!empresaId) {
      return responderEmpresaNoValida(
        res,
      );
    }

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
            "El ID de la variante no es válido.",
        });
    }

    try {
      const resultado =
        await variantesService.eliminarVariante(
          id,
          empresaId,
        );

      if (
        resultado.motivo ===
        "NO_ENCONTRADA"
      ) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Variante no encontrada.",
          });
      }

      if (
        resultado.motivo ===
        "TIENE_MOVIMIENTOS"
      ) {
        return res
          .status(409)
          .json({
            success: false,

            message:
              "No se puede eliminar la variante porque tiene ingresos, ventas o movimientos de stock asociados.",
          });
      }

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Variante eliminada correctamente.",
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };