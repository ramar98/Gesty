const codigosService = require(
  "../services/codigosService",
);

function responderError(res, error) {
  const erroresControlados = {
    CODIGO_INVALIDO: { status: 400, message: error.message },
    FECHA_INVALIDA: { status: 400, message: error.message },
    TIPO_INVALIDO: {
      status: 400,
      message: error.message,
    },

    MESES_INVALIDOS: {
      status: 400,
      message: error.message,
    },

    DESCUENTO_INVALIDO: {
      status: 400,
      message: error.message,
    },

    USOS_INVALIDOS: {
      status: 400,
      message: error.message,
    },

    CODIGO_VACIO: {
      status: 400,
      message: error.message,
    },

    CODIGO_NO_EXISTE: {
      status: 404,
      message: error.message,
    },

    CODIGO_INACTIVO: {
      status: 400,
      message: error.message,
    },

    CODIGO_VENCIDO: {
      status: 400,
      message: error.message,
    },

    CODIGO_AGOTADO: {
      status: 400,
      message: error.message,
    },

    ER_DUP_ENTRY: {
      status: 409,
      message:
        "Ya existe un código con ese valor.",
    },
  };

  const controlado =
    erroresControlados[error.code];

  if (controlado) {
    return res
      .status(controlado.status)
      .json({
        success: false,

        message: controlado.message,

        error: {
          code: error.code,
        },
      });
  }

  console.error(
    "Error en códigos promocionales:",
    error,
  );

  return res.status(500).json({
    success: false,

    message:
      "Ocurrió un error interno con los códigos promocionales.",
  });
}

/*
 * ===================================
 * VALIDAR CÓDIGO (público)
 *
 * Se usa en el registro y antes de
 * pagar para mostrar qué otorga.
 * ===================================
 */

exports.validar = async (req, res) => {
  try {
    const codigo =
      await codigosService.validarCodigo(
        req.body?.codigo ??
          req.params.codigo,
      );

    return res.status(200).json({
      success: true,

      data: {
        codigo: codigo.codigo,
        tipo: codigo.tipo,
        meses_gratis:
          codigo.meses_gratis,
        descuento_porcentaje:
          codigo.descuento_porcentaje,
      },
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * SUPERADMIN: CRUD
 * ===================================
 */

exports.listar = async (req, res) => {
  try {
    const codigos =
      await codigosService.listarCodigos();

    return res.status(200).json({
      success: true,

      data: codigos,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

exports.crear = async (req, res) => {
  try {
    const codigo =
      await codigosService.crearCodigo(
        req.body ?? {},
      );

    return res.status(201).json({
      success: true,

      message:
        "Código creado correctamente.",

      data: codigo,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

exports.desactivar = async (
  req,
  res,
) => {
  try {
    await codigosService.desactivarCodigo(
      req.params.id,
    );

    return res.status(200).json({
      success: true,

      message:
        "Código desactivado correctamente.",
    });
  } catch (error) {
    return responderError(res, error);
  }
};
