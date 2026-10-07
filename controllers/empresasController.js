const registroService = require(
  "../services/registroService",
);

function normalizarTexto(valor) {
  if (
    typeof valor !== "string"
  ) {
    return "";
  }

  return valor.trim();
}

function normalizarTextoOpcional(
  valor,
) {
  const texto =
    normalizarTexto(valor);

  return texto || null;
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email,
  );
}

function validarAlta(
  body = {},
) {
  const errores = [];

  const empresaBody =
    body.empresa ?? {};

  const adminBody =
    body.administrador ?? {};

  const empresa = {
    nombre:
      normalizarTexto(
        empresaBody.nombre,
      ),

    cuit:
      normalizarTextoOpcional(
        empresaBody.cuit,
      ),

    email:
      normalizarTextoOpcional(
        empresaBody.email,
      )?.toLowerCase() ??
      null,

    telefono:
      normalizarTextoOpcional(
        empresaBody.telefono,
      ),

    plan:
      normalizarTexto(
        empresaBody.plan,
      ).toUpperCase() ||
      "BASICO",
  };

  const administrador = {
    nombre:
      normalizarTexto(
        adminBody.nombre,
      ),

    apellido:
      normalizarTexto(
        adminBody.apellido,
      ),

    usuario:
      normalizarTexto(
        adminBody.usuario,
      ),

    email:
      normalizarTexto(
        adminBody.email,
      ).toLowerCase(),

    password:
      typeof adminBody.password ===
      "string"
        ? adminBody.password
        : "",
  };

  /*
   * =================================
   * EMPRESA
   * =================================
   */

  if (!empresa.nombre) {
    errores.push(
      "El nombre de la empresa es obligatorio.",
    );
  }

  if (
    empresa.nombre.length > 150
  ) {
    errores.push(
      "El nombre de la empresa no puede superar los 150 caracteres.",
    );
  }

  if (
    empresa.email &&
    !validarEmail(
      empresa.email,
    )
  ) {
    errores.push(
      "El email de la empresa no es válido.",
    );
  }

  if (
    empresa.email &&
    empresa.email.length > 150
  ) {
    errores.push(
      "El email de la empresa no puede superar los 150 caracteres.",
    );
  }

  if (
    empresa.cuit &&
    empresa.cuit.length > 20
  ) {
    errores.push(
      "El CUIT no puede superar los 20 caracteres.",
    );
  }

  if (
    empresa.telefono &&
    empresa.telefono.length > 50
  ) {
    errores.push(
      "El teléfono no puede superar los 50 caracteres.",
    );
  }

  /*
   * =================================
   * ADMINISTRADOR
   * =================================
   */

  if (
    !administrador.nombre
  ) {
    errores.push(
      "El nombre del administrador es obligatorio.",
    );
  }

  if (
    administrador.nombre.length >
    100
  ) {
    errores.push(
      "El nombre del administrador no puede superar los 100 caracteres.",
    );
  }

  if (
    !administrador.apellido
  ) {
    errores.push(
      "El apellido del administrador es obligatorio.",
    );
  }

  if (
    administrador.apellido.length >
    100
  ) {
    errores.push(
      "El apellido del administrador no puede superar los 100 caracteres.",
    );
  }

  if (
    !administrador.usuario
  ) {
    errores.push(
      "El nombre de usuario es obligatorio.",
    );
  }

  if (
    administrador.usuario.length >
    50
  ) {
    errores.push(
      "El usuario no puede superar los 50 caracteres.",
    );
  }

  if (
    !administrador.email
  ) {
    errores.push(
      "El email del administrador es obligatorio.",
    );
  } else if (
    !validarEmail(
      administrador.email,
    )
  ) {
    errores.push(
      "El email del administrador no es válido.",
    );
  }

  if (
    administrador.email.length >
    150
  ) {
    errores.push(
      "El email del administrador no puede superar los 150 caracteres.",
    );
  }

  if (
    !administrador.password
  ) {
    errores.push(
      "La contraseña es obligatoria.",
    );
  } else if (
    administrador.password.length <
    8
  ) {
    errores.push(
      "La contraseña debe tener al menos 8 caracteres.",
    );
  } else if (
    administrador.password.length >
    72
  ) {
    errores.push(
      "La contraseña no puede superar los 72 caracteres.",
    );
  }

  const codigoPromocional =
    normalizarTextoOpcional(
      body.codigo_promocional,
    );

  if (
    codigoPromocional &&
    codigoPromocional.length > 50
  ) {
    errores.push(
      "El código promocional no puede superar los 50 caracteres.",
    );
  }

  return {
    valido:
      errores.length === 0,

    errores,

    datos: {
      empresa,
      administrador,
      codigoPromocional,
    },
  };
}

function responderError(
  res,
  error,
) {
  const erroresControlados = {
    ROL_ADMIN_NO_ENCONTRADO: {
      status: 500,

      message:
        "No está configurado el rol Administrador.",
    },

    USUARIO_DUPLICADO: {
      status: 409,

      message:
        "Ya existe un usuario con esos datos.",
    },

    ER_DUP_ENTRY: {
      status: 409,

      message:
        "Ya existe un registro con esos datos.",
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

    CODIGO_VACIO: {
      status: 400,

      message: error.message,
    },

    CODIGO_TIPO_INCORRECTO: {
      status: 400,

      message: error.message,
    },

    MP_NO_CONFIGURADO: {
      status: 503,

      message:
        "El pago con Mercado Pago no está configurado.",
    },

    REGISTRO_NO_ENCONTRADO: {
      status: 404,

      message: error.message,
    },
  };

  const controlado =
    erroresControlados[
      error.code
    ];

  if (controlado) {
    return res
      .status(
        controlado.status,
      )
      .json({
        success: false,

        message:
          controlado.message,

        error: {
          code:
            error.code,
        },
      });
  }

  console.error(
    "Error creando empresa:",
    error,
  );

  return res
    .status(500)
    .json({
      success: false,

      message:
        "Ocurrió un error interno creando la empresa.",

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
 * CREAR EMPRESA
 * =====================================
 */

exports.crearEmpresa =
  async (
    req,
    res,
  ) => {
    const validacion =
      validarAlta(
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
            "Los datos de alta de la empresa no son válidos.",

          errors:
            validacion.errores,
        });
    }

    try {
      const resultado =
        await registroService.iniciarRegistro(
          validacion.datos,
        );

      return res
        .status(201)
        .json({
          success: true,

          message:
            resultado.requiere_pago
              ? "Registro iniciado. Completá el pago para crear la empresa."
              : "Empresa creada correctamente.",

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
 * =====================================
 * ESTADO DE REGISTRO PAGADO
 *
 * Público: la referencia REG-XXXX es
 * el identificador secreto del pago.
 * Si MP ya acreditó, materializa la
 * empresa.
 * =====================================
 */

exports.estadoRegistro =
  async (
    req,
    res,
  ) => {
    try {
      const resultado =
        await registroService.verificarRegistro(
          req.params
            .referencia,
        );

      return res
        .status(200)
        .json({
          success: true,

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