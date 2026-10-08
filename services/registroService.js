const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const db = require("../config/db");

const empresasService = require(
  "./empresasService",
);

const codigosService = require(
  "./codigosService",
);

const pagosService = require(
  "./pagosService",
);

const suscripcionesService = require(
  "./suscripcionesService",
);

/*
 * =====================================
 * REGISTRO PAGADO DE EMPRESAS
 *
 * Flujo:
 *   1. POST /api/empresas valida los
 *      datos y crea un pago pendiente
 *      con referencia REG-XXXX.
 *   2. El usuario paga escaneando el
 *      QR de Mercado Pago que se
 *      muestra en la propia pantalla.
 *   3. El webhook o GET /registro/:ref
 *      confirman el pago y recién ahí
 *      se crean empresa + admin.
 * =====================================
 */

const generarReferencia = () =>
  "REG-" +
  crypto
    .randomBytes(8)
    .toString("hex")
    .toUpperCase();

/*
 * =====================================
 * INICIAR REGISTRO
 *
 * Si hay código MESES_GRATIS crea la
 * empresa directo. Si no (o es de
 * descuento) genera el pago y devuelve
 * el init_point de Mercado Pago.
 * =====================================
 */

const iniciarRegistro = async (datos) => {
  const { codigoPromocional } = datos;

  let codigoRegistro = null;

  if (codigoPromocional) {
    codigoRegistro =
      await codigosService.validarCodigo(
        codigoPromocional,
      );
  }

  /*
   * =================================
   * REGISTRO PAGO
   *
   * Todo alta pasa por el pago: el
   * código solo cambia el precio.
   *
   * DESCUENTO: rebaja el % del monto.
   * MESES_GRATIS: descuento del 100%
   * (queda en $0 y se acredita solo,
   * con los meses gratis del código).
   * =================================
   */

  const esGratis =
    codigoRegistro?.tipo ===
    "MESES_GRATIS";

  const meses = esGratis
    ? codigoRegistro.meses_gratis
    : 1;

  const descuento = esGratis
    ? 1
    : codigoRegistro?.tipo ===
        "DESCUENTO"
      ? Number(
          codigoRegistro.descuento_porcentaje,
        ) / 100
      : 0;

  const monto =
    Math.round(
      suscripcionesService.PRECIO_MENSUAL *
        meses *
        (1 - descuento) *
        100,
    ) / 100;

  const referencia = generarReferencia();

  /*
   * La password viaja hasheada: el
   * registro puede quedar pendiente
   * bastante tiempo.
   */

  const passwordHash = await bcrypt.hash(
    datos.administrador.password,
    12,
  );

  const datosGuardar = {
    empresa: datos.empresa,

    administrador: {
      nombre:
        datos.administrador.nombre,
      apellido:
        datos.administrador.apellido,
      usuario:
        datos.administrador.usuario,
      email:
        datos.administrador.email,
      passwordHash,
    },
  };

  const [result] = await db.query(
    `
      INSERT INTO pagos_registro
      (
        referencia,
        datos,
        meses,
        monto,
        codigo_id
      )

      VALUES (?, ?, ?, ?, ?)
    `,
    [
      referencia,
      JSON.stringify(datosGuardar),
      meses,
      monto,
      codigoRegistro?.id ?? null,
    ],
  );

  /*
   * Código de meses gratis: el monto
   * quedó en $0 — se acredita solo y
   * se materializa la empresa sin
   * pasar por Mercado Pago.
   */

  if (monto <= 0) {
    await db.query(
      `
        UPDATE pagos_registro

        SET
          estado = 'APROBADO',
          pagado_at = NOW()

        WHERE referencia = ?
      `,
      [referencia],
    );

    await materializarEmpresa(
      referencia,
    );

    return {
      requiere_pago: true,

      pago: {
        referencia,
        monto,
        monto_original:
          Math.round(
            suscripcionesService.PRECIO_MENSUAL *
              meses *
              100,
          ) / 100,
        codigo:
          codigoRegistro?.codigo ??
          null,
        meses,
        gratis: true,
      },
    };
  }

  /*
   * Orden QR de Mercado Pago: el
   * cliente escanea y paga desde su
   * app, sin salir de nuestra
   * pantalla de pago.
   */

  const orden =
    await pagosService.crearOrdenQr({
      referencia,
      titulo: `Gesty - Alta de empresa (${meses} mes${
        meses > 1 ? "es" : ""
      })`,
      monto,
    });

  await db.query(
    `
      UPDATE pagos_registro

      SET mp_preference_id = ?

      WHERE referencia = ?
    `,
    [orden.orden_id, referencia],
  );

  return {
    requiere_pago: true,

    pago: {
      referencia,
      monto,
      monto_original:
        Math.round(
          suscripcionesService.PRECIO_MENSUAL *
            meses *
            100,
        ) / 100,
      codigo:
        codigoRegistro?.codigo ??
        null,
      meses,
      qr_imagen:
        orden.qr_imagen,
    },
  };
};

/*
 * =====================================
 * CONFIRMAR REGISTRO
 *
 * Con el pago aprobado en MP, crea la
 * empresa con la suscripción paga.
 * Idempotente.
 * =====================================
 */

const confirmarRegistro = async (
  referencia,
  mpPaymentId,
  estadoMp,
  montoMp,
) => {
  const estadoFinal =
    estadoMp === "approved"
      ? "APROBADO"
      : estadoMp === "rejected" ||
          estadoMp === "cancelled"
        ? "RECHAZADO"
        : "PENDIENTE";

  const [update] = await db.query(
    `
      UPDATE pagos_registro

      SET
        estado = ?,
        mp_payment_id = ?,
        pagado_at =
          CASE
            WHEN ? = 'APROBADO'
              THEN NOW()
            ELSE pagado_at
          END

      WHERE
        referencia = ?
        AND estado = 'PENDIENTE'
    `,
    [
      estadoFinal,
      String(mpPaymentId),
      estadoFinal,
      referencia,
    ],
  );

  /*
   * Ya procesado: vemos si falta
   * materializar la empresa.
   */

  if (update.affectedRows === 0) {
    const [rows] = await db.query(
      `
        SELECT empresa_id, estado

        FROM pagos_registro

        WHERE referencia = ?
      `,
      [referencia],
    );

    const registro = rows[0];

    if (
      registro?.estado ===
        "APROBADO" &&
      !registro.empresa_id
    ) {
      return materializarEmpresa(
        referencia,
      );
    }

    return {
      procesado: false,
      creada: Boolean(
        registro?.empresa_id,
      ),
    };
  }

  if (estadoFinal !== "APROBADO") {
    return {
      procesado: true,
      creada: false,
      estado: estadoFinal,
    };
  }

  /*
   * Validación de monto antes de
   * materializar.
   */

  const [rows] = await db.query(
    `
      SELECT monto

      FROM pagos_registro

      WHERE referencia = ?
    `,
    [referencia],
  );

  const esperado = Number(
    rows[0]?.monto,
  );

  if (
    Number.isFinite(montoMp) &&
    Math.abs(esperado - montoMp) >
      0.01
  ) {
    throw new Error(
      `El monto del pago no coincide: esperado ${esperado}, recibido ${montoMp}.`,
    );
  }

  return materializarEmpresa(
    referencia,
  );
};

/*
 * =====================================
 * MATERIALIZAR EMPRESA
 *
 * Crea empresa + admin + config con
 * los datos guardados y le acredita
 * los meses pagados.
 * =====================================
 */

const materializarEmpresa = async (
  referencia,
) => {
  const [rows] = await db.query(
    `
      SELECT id, datos, meses, codigo_id, empresa_id

      FROM pagos_registro

      WHERE referencia = ?
    `,
    [referencia],
  );

  const registro = rows[0];

  if (!registro) {
    throw new Error(
      "El registro de pago no existe.",
    );
  }

  if (registro.empresa_id) {
    return {
      procesado: false,
      creada: true,
    };
  }

  const datos =
    typeof registro.datos === "string"
      ? JSON.parse(registro.datos)
      : registro.datos;

  const resultado =
    await empresasService.crearEmpresa({
      empresa: datos.empresa,

      administrador:
        datos.administrador,

      mesesPagados: registro.meses,
    });

  await db.query(
    `
      UPDATE pagos_registro

      SET empresa_id = ?

      WHERE referencia = ?
    `,
    [resultado.empresa.id, referencia],
  );

  if (registro.codigo_id) {
    await db.query(
      `
        UPDATE codigos_promocionales

        SET usos = usos + 1

        WHERE id = ?
      `,
      [registro.codigo_id],
    );
  }

  return {
    procesado: true,
    creada: true,
    empresa: resultado.empresa,
  };
};

/*
 * =====================================
 * VERIFICAR REGISTRO
 *
 * Consulta MP en vivo para el
 * registro pendiente (igual que la
 * verificación de pagos de
 * suscripción).
 * =====================================
 */

const verificarRegistro = async (
  referencia,
) => {
  const [rows] = await db.query(
    `
      SELECT estado, empresa_id

      FROM pagos_registro

      WHERE referencia = ?
    `,
    [referencia],
  );

  const registro = rows[0];

  if (!registro) {
    const error = new Error(
      "El registro indicado no existe.",
    );

    error.code =
      "REGISTRO_NO_ENCONTRADO";

    throw error;
  }

  if (registro.empresa_id) {
    return {
      creada: true,
    };
  }

  /*
   * Aprobada pero sin materializar
   * (p.ej. falló la creación al
   * iniciar): reintentamos.
   */

  if (registro.estado === "APROBADO") {
    return materializarEmpresa(
      referencia,
    );
  }

  const pagoMp =
    await pagosService.buscarPagoPorReferencia(
      referencia,
    );

  if (!pagoMp) {
    return {
      creada: false,
      estado: "SIN_ACREDITAR",
    };
  }

  const resultado =
    await confirmarRegistro(
      referencia,
      pagoMp.id,
      pagoMp.status,
      Number(
        pagoMp.transaction_amount,
      ),
    );

  return {
    creada: Boolean(
      resultado.creada,
    ),
    ...resultado,
  };
};

module.exports = {
  iniciarRegistro,
  confirmarRegistro,
  verificarRegistro,
};
