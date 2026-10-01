const cajaService =
  require(
    "../services/cajaService",
  );

function obtenerEmpresaId(
  req,
) {
  return Number(
    req.usuario?.empresa_id ??
      req.user?.empresa_id ??
      req.auth?.empresaId ??
      0,
  );
}

function obtenerUsuarioId(
  req,
) {
  return Number(
    req.usuario?.id ??
      req.user?.id ??
      req.auth?.userId ??
      0,
  );
}

function responderError(
  res,
  error,
) {
  const errores400 = [
    "APERTURA_INVALIDA",
    "SALDO_INICIAL_INVALIDO",
    "CIERRE_INVALIDO",
    "EFECTIVO_INVALIDO",
    "MOVIMIENTO_INVALIDO",
    "TIPO_MOVIMIENTO_INVALIDO",
    "MEDIO_PAGO_INVALIDO",
    "MONTO_INVALIDO",
    "TURNO_NO_VALIDO",
  ];

  if (
    errores400.includes(
      error.code,
    )
  ) {
    return res
      .status(400)
      .json({
        success:
          false,

        message:
          error.message,
      });
  }

  if (
    error.code ===
      "CAJA_YA_ABIERTA" ||
    error.code ===
      "CAJA_YA_CERRADA"
  ) {
    return res
      .status(409)
      .json({
        success:
          false,

        message:
          error.message,
      });
  }

  if (
    error.code ===
      "CAJA_NO_ENCONTRADA" ||
    error.code ===
      "TURNO_NO_ENCONTRADO"
  ) {
    return res
      .status(404)
      .json({
        success:
          false,

        message:
          error.message,
      });
  }

  if (
    error.code ===
    "CAJA_CERRADA"
  ) {
    return res
      .status(409)
      .json({
        success:
          false,

        message:
          error.message,
      });
  }

  console.error(
    "Error módulo caja:",
    error,
  );

  return res
    .status(500)
    .json({
      success:
        false,

      message:
        "Ocurrió un error al procesar la operación de caja.",
    });
}

/*
 * GET /api/caja/actual
 */

exports.obtenerCajaActual =
  async (
    req,
    res,
  ) => {
    try {
      const empresaId =
        obtenerEmpresaId(
          req,
        );

      if (!empresaId) {
        return res
          .status(403)
          .json({
            success:
              false,

            message:
              "No se pudo determinar la empresa del usuario.",
          });
      }

      const resultado =
        await cajaService.obtenerCajaActual(
          empresaId,
        );

      return res
        .status(200)
        .json({
          success:
            true,

          data:
            resultado,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * POST /api/caja/abrir
 */

exports.abrirCaja =
  async (
    req,
    res,
  ) => {
    try {
      const empresaId =
        obtenerEmpresaId(
          req,
        );

      const usuarioId =
        obtenerUsuarioId(
          req,
        );

      const resultado =
        await cajaService.abrirCaja({
          empresaId,
          usuarioId,

          cajaId:
            req.body
              ?.caja_id,

          saldoInicial:
            req.body
              ?.saldo_inicial ??
            0,

          observacion:
            req.body
              ?.observacion,
        });

      return res
        .status(201)
        .json({
          success:
            true,

          message:
            "Caja abierta correctamente.",

          data:
            resultado,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * POST /api/caja/movimientos
 */

exports.registrarMovimiento =
  async (
    req,
    res,
  ) => {
    try {
      const empresaId =
        obtenerEmpresaId(
          req,
        );

      const usuarioId =
        obtenerUsuarioId(
          req,
        );

      const tipo =
        String(
          req.body
            ?.tipo ??
            "",
        )
          .trim()
          .toUpperCase();

      /*
       * Desde este endpoint solamente
       * permitimos movimientos manuales.
       *
       * VENTA y ANULACION_VENTA
       * serán creados exclusivamente
       * por ventasService.
       */

      if (
        !cajaService
          .TIPOS_MANUALES
          .includes(
            tipo,
          )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "El tipo de movimiento manual no es válido.",
          });
      }

      const movimiento =
        await cajaService.registrarMovimiento({
          empresaId,
          usuarioId,
          tipo,

          medioPago:
            req.body
              ?.medio_pago ??
            "EFECTIVO",

          monto:
            req.body
              ?.monto,

          descripcion:
            req.body
              ?.descripcion,
        });

      return res
        .status(201)
        .json({
          success:
            true,

          message:
            tipo ===
            "EGRESO"
              ? "Egreso registrado correctamente."
              : "Movimiento registrado correctamente.",

          data:
            movimiento,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * POST /api/caja/cerrar
 */

exports.cerrarCaja =
  async (
    req,
    res,
  ) => {
    try {
      const empresaId =
        obtenerEmpresaId(
          req,
        );

      const usuarioId =
        obtenerUsuarioId(
          req,
        );

      const resultado =
        await cajaService.cerrarCaja({
          empresaId,
          usuarioId,

          turnoId:
            req.body
              ?.turno_id,

          efectivoDeclarado:
            req.body
              ?.efectivo_declarado,

          observacion:
            req.body
              ?.observacion,
        });

      return res
        .status(200)
        .json({
          success:
            true,

          message:
            "Caja cerrada correctamente.",

          data:
            resultado,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * GET /api/caja/historial
 */

exports.obtenerHistorial =
  async (
    req,
    res,
  ) => {
    try {
      const empresaId =
        obtenerEmpresaId(
          req,
        );

      const datos =
        await cajaService.obtenerHistorial(
          empresaId,
          {
            limite:
              req.query
                ?.limite,
          },
        );

      return res
        .status(200)
        .json({
          success:
            true,

          data:
            datos,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };

/*
 * GET /api/caja/:turnoId
 */

exports.obtenerTurno =
  async (
    req,
    res,
  ) => {
    try {
      const empresaId =
        obtenerEmpresaId(
          req,
        );

      const turnoId =
        Number(
          req.params
            .turnoId,
        );

      const turno =
        await cajaService.obtenerTurnoPorId(
          empresaId,
          turnoId,
        );

      if (!turno) {
        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Turno de caja no encontrado.",
          });
      }

      return res
        .status(200)
        .json({
          success:
            true,

          data:
            turno,
        });
    } catch (error) {
      return responderError(
        res,
        error,
      );
    }
  };