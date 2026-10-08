const db = require("../config/db");

const suscripcionesService = require(
  "../services/suscripcionesService",
);

const pagosService = require(
  "../services/pagosService",
);

const codigosService = require(
  "../services/codigosService",
);

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

function responderError(res, error) {
  const erroresControlados = {
    PAGO_INVALIDO: { status: 400, message: error.message },
    PAGO_NO_ENCONTRADO: { status: 404, message: error.message },
    MP_QR_NO_CONFIGURADO: { status: 503, message: "El pago con QR no está configurado. Contactá al administrador." },
    MP_QR_ERROR: { status: 502, message: "Mercado Pago no pudo completar la operación. Intentá nuevamente." },
    MONTO_INVALIDO: { status: 409, message: error.message },
    EMPRESA_NO_ENCONTRADA: {
      status: 404,
      message:
        "La empresa no existe.",
    },

    MESES_INVALIDOS: {
      status: 400,
      message: error.message,
    },

    MP_NO_CONFIGURADO: {
      status: 503,
      message:
        "El pago con Mercado Pago no está configurado.",
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

    CODIGO_TIPO_INCORRECTO: {
      status: 400,
      message: error.message,
    },

    FIRMA_INVALIDA: {
      status: 401,
      message:
        "La firma del webhook no es válida.",
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
    "Error en suscripciones:",
    error,
  );

  return res.status(500).json({
    success: false,

    message:
      "Ocurrió un error interno en suscripciones.",
  });
}

/*
 * ===================================
 * GET ESTADO DE SUSCRIPCIÓN
 * ===================================
 */

exports.obtenerEstado = async (
  req,
  res,
) => {
  const empresaId =
    obtenerEmpresaId(req);

  if (!empresaId) {
    return res.status(403).json({
      success: false,

      message:
        "No se pudo determinar la empresa del usuario autenticado.",
    });
  }

  try {
    const estado =
      await suscripcionesService.obtenerEstado(
        empresaId,
      );

    return res.status(200).json({
      success: true,

      data: estado,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * CREAR PAGO (preferencia MP)
 * ===================================
 */

exports.crearPago = async (
  req,
  res,
) => {
  const empresaId =
    obtenerEmpresaId(req);

  if (!empresaId) {
    return res.status(403).json({
      success: false,

      message:
        "No se pudo determinar la empresa del usuario autenticado.",
    });
  }

  try {
    const pago =
      await pagosService.crearPago(
        empresaId,
        {
          meses: req.body?.meses,
          codigo: req.body?.codigo,
        },
      );

    return res.status(201).json({
      success: true,

      data: pago,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * VERIFICAR PAGO PENDIENTE
 *
 * Consulta Mercado Pago en vivo por
 * el último pago pendiente de la
 * empresa. Útil para acreditar sin
 * depender del webhook (local, caídas,
 * demoras de notificación).
 * ===================================
 */

exports.verificarPago = async (
  req,
  res,
) => {
  const empresaId =
    obtenerEmpresaId(req);

  if (!empresaId) {
    return res.status(403).json({
      success: false,

      message:
        "No se pudo determinar la empresa del usuario autenticado.",
    });
  }

  try {
    const resultado =
      await pagosService.verificarPagoPendiente(
        empresaId,
        req.body?.pago_id ?? null,
      );

    const estado =
      await suscripcionesService.obtenerEstado(
        empresaId,
      );

    return res.status(200).json({
      success: true,

      data: {
        ...resultado,
        suscripcion: estado,
      },
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * CANJEAR CÓDIGO DE MESES GRATIS
 *
 * El usuario autenticado canjea un
 * código MESES_GRATIS sobre su propia
 * empresa.
 * ===================================
 */

exports.canjearCodigo = async (
  req,
  res,
) => {
  const empresaId =
    obtenerEmpresaId(req);

  if (!empresaId) {
    return res.status(403).json({
      success: false,

      message:
        "No se pudo determinar la empresa del usuario autenticado.",
    });
  }

  try {
    const codigo =
      await codigosService.validarCodigo(
        req.body?.codigo,
      );

    if (codigo.tipo !== "MESES_GRATIS") {
      const error = new Error(
        "Este código es de descuento: usalo al pagar con Mercado Pago.",
      );

      error.code =
        "CODIGO_TIPO_INCORRECTO";

      throw error;
    }

    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      await codigosService.consumirCodigo(
        codigo.id,
        connection,
      );

      await suscripcionesService.extender(
        empresaId,
        codigo.meses_gratis,
        connection,
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();

      throw error;
    } finally {
      connection.release();
    }

    const estado =
      await suscripcionesService.obtenerEstado(
        empresaId,
      );

    return res.status(200).json({
      success: true,

      message: `Se acreditaron ${codigo.meses_gratis} mes(es) gratis.`,

      data: estado,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * WEBHOOK MERCADO PAGO (público)
 * ===================================
 */

exports.webhook = async (req, res) => {
  try {
    await pagosService.procesarWebhook(
      req,
    );

    /*
     * MP espera un 200 rápido siempre
     * que la notificación sea válida.
     */

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * SUPERADMIN: MÉTRICAS PLATAFORMA
 * ===================================
 */

exports.obtenerMetricas = async (
  req,
  res,
) => {
  try {
    const metricas =
      await suscripcionesService.obtenerMetricas();

    return res.status(200).json({
      success: true,

      data: metricas,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * SUPERADMIN: LISTAR EMPRESAS
 * ===================================
 */

exports.listarEmpresas = async (
  req,
  res,
) => {
  try {
    const empresas =
      await suscripcionesService.listarEmpresas();

    return res.status(200).json({
      success: true,

      data: empresas,
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/*
 * ===================================
 * SUPERADMIN: EXTENDER MANUAL
 * ===================================
 */

exports.extenderEmpresa = async (
  req,
  res,
) => {
  try {
    await suscripcionesService.extender(
      req.params.id,
      req.body?.meses,
    );

    const estado =
      await suscripcionesService.obtenerEstado(
        req.params.id,
      );

    return res.status(200).json({
      success: true,

      message:
        "Suscripción extendida correctamente.",

      data: estado,
    });
  } catch (error) {
    return responderError(res, error);
  }
};
