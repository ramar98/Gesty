const crypto = require("crypto");

const db = require("../config/db");

const suscripcionesService = require(
  "./suscripcionesService",
);

const codigosService = require(
  "./codigosService",
);

/*
 * =====================================
 * CLIENTE MERCADO PAGO
 * (lazy: solo se crea si hay token)
 * =====================================
 */

let preferenceClient = null;
let paymentClient = null;

function obtenerClientes() {
  if (!process.env.MP_ACCESS_TOKEN) {
    const error = new Error(
      "Mercado Pago no está configurado en el servidor.",
    );

    error.code =
      "MP_NO_CONFIGURADO";

    throw error;
  }

  if (!preferenceClient) {
    const {
      MercadoPagoConfig,
      Preference,
      Payment,
    } = require("mercadopago");

    const config =
      new MercadoPagoConfig({
        accessToken:
          process.env.MP_ACCESS_TOKEN,
      });

    preferenceClient =
      new Preference(config);

    paymentClient = new Payment(
      config,
    );
  }

  return {
    preferenceClient,
    paymentClient,
  };
}

/*
 * =====================================
 * FIRMA DEL WEBHOOK
 *
 * Mercado Pago firma las notificaciones
 * con HMAC-SHA256 sobre:
 *   id:{data.id};request-id:{x-request-id};ts:{ts};
 * =====================================
 */

function verificarFirmaWebhook(req) {
  const secreto =
    process.env.MP_WEBHOOK_SECRET;

  /*
   * Sin secreto configurado no podemos
   * verificar: solo aceptamos en
   * desarrollo.
   */
  if (!secreto) {
    return (
      process.env.NODE_ENV !==
      "production"
    );
  }

  const signature =
    req.headers["x-signature"];

  const requestId =
    req.headers["x-request-id"];

  if (!signature || !requestId) {
    return false;
  }

  const partes = Object.fromEntries(
    String(signature)
      .split(",")
      .map((parte) => {
        const idx =
          parte.indexOf("=");

        return [
          parte.slice(0, idx).trim(),
          parte.slice(idx + 1).trim(),
        ];
      }),
  );

  const ts = partes.ts;
  const v1 = partes.v1;

  const dataId = String(
    req.query?.["data.id"] ??
      req.query?.id ??
      "",
  ).toLowerCase();

  if (!ts || !v1 || !dataId) {
    return false;
  }

  const manifiesto =
    `id:${dataId};request-id:${requestId};ts:${ts};`;

  const firma = crypto
    .createHmac("sha256", secreto)
    .update(manifiesto)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(firma),
    Buffer.from(String(v1)),
  );
}

/*
 * =====================================
 * CREAR PAGO / PREFERENCIA
 * =====================================
 */

const crearPago = async (
  empresaId,
  { meses = 1, codigo } = {},
) => {
  const mesesEntero = Number(meses);

  if (
    !Number.isInteger(mesesEntero) ||
    mesesEntero <= 0 ||
    mesesEntero > 12
  ) {
    const error = new Error(
      "La cantidad de meses debe ser entre 1 y 12.",
    );

    error.code = "MESES_INVALIDOS";

    throw error;
  }

  /*
   * =================================
   * CÓDIGO DE DESCUENTO (opcional)
   * =================================
   */

  let codigoRegistro = null;

  if (codigo) {
    codigoRegistro =
      await codigosService.validarCodigo(
        codigo,
      );

    if (
      codigoRegistro.tipo !==
      "DESCUENTO"
    ) {
      const error = new Error(
        "Este código otorga meses gratis: usalo desde la opción de canje.",
      );

      error.code =
        "CODIGO_TIPO_INCORRECTO";

      throw error;
    }
  }

  const descuento =
    codigoRegistro
      ? Number(
          codigoRegistro.descuento_porcentaje,
        ) / 100
      : 0;

  const monto =
    Math.round(
      suscripcionesService
        .PRECIO_MENSUAL *
        mesesEntero *
        (1 - descuento) *
        100,
    ) / 100;

  /*
   * =================================
   * REGISTRO PENDIENTE
   * =================================
   */

  const [result] = await db.query(
    `
      INSERT INTO pagos_suscripcion
      (
        empresa_id,
        codigo_id,
        monto,
        meses
      )

      VALUES (?, ?, ?, ?)
    `,
    [
      empresaId,
      codigoRegistro?.id ?? null,
      monto,
      mesesEntero,
    ],
  );

  const pagoId = Number(
    result.insertId,
  );

  /*
   * =================================
   * PREFERENCIA MERCADO PAGO
   * =================================
   */

  const frontendUrl = String(
    process.env.FRONTEND_URL ||
      "http://localhost:5173",
  ).replace(/\/+$/, "");

  const apiUrl = String(
    process.env.API_PUBLIC_URL ||
      "http://localhost:3001",
  ).replace(/\/+$/, "");

  const body = {
    items: [
      {
        id: "suscripcion-gesty",
        title: `Gesty - Suscripción (${mesesEntero} mes${
          mesesEntero > 1 ? "es" : ""
        })`,
        quantity: 1,
        unit_price: monto,
        currency_id: "ARS",
      },
    ],

    external_reference:
      String(pagoId),

    back_urls: {
      success: `${frontendUrl}/suscripcion?resultado=exito`,
      pending: `${frontendUrl}/suscripcion?resultado=pendiente`,
      failure: `${frontendUrl}/suscripcion?resultado=error`,
    },

    auto_return: "approved",
  };

  /*
   * MP exige URL pública para el
   * webhook: solo la enviamos si no
   * es localhost.
   */

  if (!apiUrl.includes("localhost")) {
    body.notification_url =
      `${apiUrl}/api/suscripcion/webhook`;
  }

  const { preferenceClient } =
    obtenerClientes();

  const preferencia =
    await preferenceClient.create({
      body,
    });

  await db.query(
    `
      UPDATE pagos_suscripcion

      SET mp_preference_id = ?

      WHERE id = ?
    `,
    [preferencia.id, pagoId],
  );

  return {
    pago_id: pagoId,
    monto,
    meses: mesesEntero,
    init_point:
      preferencia.init_point,
    sandbox_init_point:
      preferencia.sandbox_init_point,
  };
};

/*
 * =====================================
 * BUSCAR PAGO EN MERCADO PAGO
 *
 * Por external_reference (nuestro id
 * de pagos_suscripcion). No confiamos
 * solo en el webhook: esto permite
 * verificar el estado en vivo.
 * =====================================
 */

const buscarPagoPorReferencia = async (
  referencia,
) => {
  const referenciaLimpia = String(
    referencia ?? "",
  ).trim();

  if (!referenciaLimpia) {
    return null;
  }

  const { paymentClient } =
    obtenerClientes();

  const resultado =
    await paymentClient.search({
      options: {
        criteria: "desc",
        sort: "date_created",
        external_reference:
          referenciaLimpia,
      },
    });

  const pagos = Array.isArray(
    resultado?.results,
  )
    ? resultado.results
    : [];

  /*
   * MP puede devolver pagos que no
   * coinciden exactamente: filtramos
   * por referencia exacta.
   */

  const coincidentes = pagos.filter(
    (pago) =>
      String(
        pago?.external_reference ??
          "",
      ).trim() === referenciaLimpia,
  );

  if (coincidentes.length === 0) {
    return null;
  }

  return (
    coincidentes.find(
      (pago) =>
        pago.status === "approved",
    ) ?? coincidentes[0]
  );
};

/*
 * =====================================
 * VERIFICAR ÚLTIMO PAGO PENDIENTE
 *
 * Consulta MP en vivo por el último
 * pago pendiente de la empresa y lo
 * procesa si ya se acreditó.
 * =====================================
 */

const verificarPagoPendiente = async (
  empresaId,
) => {
  const [pendientes] = await db.query(
    `
      SELECT
        id,
        monto,
        meses

      FROM pagos_suscripcion

      WHERE
        empresa_id = ?
        AND estado = 'PENDIENTE'

      ORDER BY id DESC

      LIMIT 1
    `,
    [empresaId],
  );

  const pendiente = pendientes[0];

  if (!pendiente) {
    return {
      pendiente: false,
    };
  }

  const pagoMp =
    await buscarPagoPorReferencia(
      pendiente.id,
    );

  if (!pagoMp) {
    return {
      pendiente: true,
      estado: "SIN_ACREDITAR",
    };
  }

  const resultado =
    await registrarPagoAprobado(
      pendiente.id,
      pagoMp.id,
      pagoMp.status,
      Number(
        pagoMp.transaction_amount,
      ),
    );

  return {
    pendiente: true,
    ...resultado,
  };
};

/*
 * =====================================
 * REGISTRAR PAGO APROBADO
 *
 * Idempotente: solo extiende la
 * suscripción si el pago estaba
 * PENDIENTE.
 * =====================================
 */

const registrarPagoAprobado = async (
  pagoId,
  mpPaymentId,
  estado,
  montoMp = null,
) => {
  const estadoFinal =
    estado === "approved"
      ? "APROBADO"
      : estado === "rejected" ||
          estado === "cancelled"
        ? "RECHAZADO"
        : "PENDIENTE";

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const [updateResult] =
      await connection.query(
        `
          UPDATE pagos_suscripcion

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
            id = ?
            AND estado = 'PENDIENTE'
        `,
        [
          estadoFinal,
          String(mpPaymentId),
          estadoFinal,
          pagoId,
        ],
      );

    /*
     * Ya estaba procesado: no
     * extendemos dos veces.
     */

    if (updateResult.affectedRows === 0) {
      await connection.commit();

      return {
        procesado: false,
      };
    }

    if (estadoFinal === "APROBADO") {
      const [pagos] =
        await connection.query(
          `
            SELECT
              empresa_id,
              codigo_id,
              meses,
              monto

            FROM pagos_suscripcion

            WHERE id = ?

            LIMIT 1
          `,
          [pagoId],
        );

      const pago = pagos[0];

      if (
        pago &&
        montoMp !== null &&
        Number.isFinite(montoMp) &&
        Math.abs(
          Number(pago.monto) - montoMp,
        ) > 0.01
      ) {
        throw new Error(
          `El monto del pago no coincide: esperado ${pago.monto}, recibido ${montoMp}.`,
        );
      }

      if (pago) {
        await suscripcionesService.extender(
          pago.empresa_id,
          pago.meses,
          connection,
        );

        if (pago.codigo_id) {
          await codigosService.consumirCodigo(
            pago.codigo_id,
            connection,
          );
        }
      }
    }

    await connection.commit();

    return {
      procesado: true,
      estado: estadoFinal,
    };
  } catch (error) {
    await connection.rollback();

    throw error;
  } finally {
    connection.release();
  }
};

/*
 * =====================================
 * WEBHOOK MERCADO PAGO
 * =====================================
 */

const procesarWebhook = async (
  req,
) => {
  if (!verificarFirmaWebhook(req)) {
    const error = new Error(
      "La firma del webhook no es válida.",
    );

    error.code =
      "FIRMA_INVALIDA";

    throw error;
  }

  const tipo =
    req.query?.type ??
    req.query?.topic ??
    req.body?.type;

  const paymentId =
    req.query?.["data.id"] ??
    req.query?.id ??
    req.body?.data?.id;

  if (
    tipo !== "payment" ||
    !paymentId
  ) {
    /*
     * Otros eventos (merchant_order,
     * etc.) los ignoramos.
     */
    return {
      procesado: false,
    };
  }

  const { paymentClient } =
    obtenerClientes();

  const pagoMp =
    await paymentClient.get({
      id: String(paymentId),
    });

  const pagoId = Number(
    pagoMp.external_reference,
  );

  if (!pagoId) {
    return {
      procesado: false,
    };
  }

  return registrarPagoAprobado(
    pagoId,
    pagoMp.id,
    pagoMp.status,
    Number(
      pagoMp.transaction_amount,
    ),
  );
};

module.exports = {
  crearPago,
  procesarWebhook,
  verificarPagoPendiente,
  buscarPagoPorReferencia,
};
