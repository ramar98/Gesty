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

  if (!paymentClient) {
    const {
      MercadoPagoConfig,
      Payment,
    } = require("mercadopago");

    const config =
      new MercadoPagoConfig({
        accessToken:
          process.env.MP_ACCESS_TOKEN,
      });

    paymentClient = new Payment(
      config,
    );
  }

  return { paymentClient };
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
   * ORDEN QR MERCADO PAGO
   *
   * El cliente paga escaneando el QR
   * con su app, sin salir de la
   * pantalla de suscripción.
   * =================================
   */

  const orden = await crearOrdenQr({
    referencia: String(pagoId),
    titulo: `Gesty - Suscripción (${mesesEntero} mes${
      mesesEntero > 1 ? "es" : ""
    })`,
    monto,
  });

  await db.query(
    `
      UPDATE pagos_suscripcion

      SET mp_preference_id = ?

      WHERE id = ?
    `,
    [orden.orden_id, pagoId],
  );

  return {
    pago_id: pagoId,
    monto,
    meses: mesesEntero,
    qr_imagen: orden.qr_imagen,
  };
};

/*
 * =====================================
 * ORDEN QR PARA REGISTRO
 *
 * Alta de empresa (referencia
 * REG-XXXX): genera una orden en el
 * QR dinámico de MP (API instore) y
 * devuelve el qr_data listo para
 * renderizar en nuestra propia
 * pantalla de pago. El cliente paga
 * escaneando con su app de MP.
 *
 * Requiere:
 *   MP_COLLECTOR_ID    (id de usuario
 *                       cobrador)
 *   MP_POS_EXTERNAL_ID (caja/POS)
 * =====================================
 */

const crearOrdenQr = async ({
  referencia,
  titulo,
  monto,
}) => {
  const collectorId =
    process.env.MP_COLLECTOR_ID;

  const posExternalId =
    process.env.MP_POS_EXTERNAL_ID;

  const token =
    process.env.MP_ACCESS_TOKEN;

  if (
    !collectorId ||
    !posExternalId ||
    !token
  ) {
    const error = new Error(
      "El pago con QR no está configurado (faltan MP_COLLECTOR_ID / MP_POS_EXTERNAL_ID).",
    );

    error.code =
      "MP_QR_NO_CONFIGURADO";

    throw error;
  }

  const apiUrl = String(
    process.env.API_PUBLIC_URL ||
      "http://localhost:3001",
  ).replace(/\/+$/, "");

  const body = {
    external_reference: referencia,
    title: titulo,
    description: titulo,
    total_amount: monto,
    items: [
      {
        title: titulo,
        description: titulo,
        quantity: 1,
        unit_price: monto,
        unit_measure: "unit",
        total_amount: monto,
      },
    ],
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

  const respuesta = await fetch(
    `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${collectorId}/pos/${posExternalId}/qrs`,
    {
      method: "PUT",
      headers: {
        Authorization:
          `Bearer ${token}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    const error = new Error(
      datos?.message ||
        "Mercado Pago no pudo generar el QR.",
    );

    error.code = "MP_QR_ERROR";

    throw error;
  }

  const QRCode = require("qrcode");

  const qrImagen =
    await QRCode.toDataURL(
      datos.qr_data,
      { width: 300, margin: 1 },
    );

  return {
    orden_id:
      datos.in_store_order_id,
    qr_data: datos.qr_data,
    qr_imagen: qrImagen,
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

  const dataId =
    req.query?.["data.id"] ??
    req.query?.id ??
    req.body?.data?.id;

  /*
   * Pagos por QR notifican una
   * merchant_order: traemos la orden
   * y procesamos cada pago asociado.
   */

  if (
    tipo === "merchant_order" &&
    dataId
  ) {
    return procesarOrdenQr(
      String(dataId),
    );
  }

  if (
    tipo !== "payment" ||
    !dataId
  ) {
    /*
     * Otros eventos los ignoramos.
     */
    return {
      procesado: false,
    };
  }

  const { paymentClient } =
    obtenerClientes();

  const pagoMp =
    await paymentClient.get({
      id: String(dataId),
    });

  const referencia = String(
    pagoMp.external_reference ?? "",
  );

  /*
   * Pagos de alta de empresa
   * (referencia REG-XXXX): los crea
   * empresa al acreditarse.
   */

  if (referencia.startsWith("REG-")) {
    const registroService = require(
      "./registroService",
    );

    return registroService.confirmarRegistro(
      referencia,
      pagoMp.id,
      pagoMp.status,
      Number(
        pagoMp.transaction_amount,
      ),
    );
  }

  const pagoId = Number(referencia);

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

/*
 * =====================================
 * ORDEN QR (merchant_order)
 *
 * Los pagos hechos escaneando el QR
 * llegan como notificación de orden,
 * no de pago. Traemos la orden y
 * procesamos cada pago aprobado.
 * =====================================
 */

const procesarOrdenQr = async (
  ordenId,
) => {
  const token =
    process.env.MP_ACCESS_TOKEN;

  const respuesta = await fetch(
    `https://api.mercadopago.com/merchant_orders/${ordenId}`,
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
    },
  );

  const orden =
    await respuesta.json();

  if (!respuesta.ok) {
    return {
      procesado: false,
    };
  }

  const resultados = [];

  const { paymentClient } =
    obtenerClientes();

  for (const pago of orden.payments ??
    []) {
    const pagoMp =
      await paymentClient.get({
        id: String(pago.id),
      });

    const referencia = String(
      pagoMp.external_reference ?? "",
    );

    if (
      referencia.startsWith("REG-")
    ) {
      const registroService = require(
        "./registroService",
      );

      resultados.push(
        await registroService.confirmarRegistro(
          referencia,
          pagoMp.id,
          pagoMp.status,
          Number(
            pagoMp.transaction_amount,
          ),
        ),
      );
    } else {
      const pagoId =
        Number(referencia);

      if (pagoId) {
        resultados.push(
          await registrarPagoAprobado(
            pagoId,
            pagoMp.id,
            pagoMp.status,
            Number(
              pagoMp.transaction_amount,
            ),
          ),
        );
      }
    }
  }

  return {
    procesado:
      resultados.length > 0,
  };
};

module.exports = {
  crearPago,
  crearOrdenQr,
  procesarWebhook,
  verificarPagoPendiente,
  buscarPagoPorReferencia,
  registrarPagoAprobado,
};
