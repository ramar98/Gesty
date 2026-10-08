/*
 * =====================================================
 * SIMULAR PAGO ACREDITADO (solo dev)
 *
 * Recorre el mismo camino que el
 * webhook de Mercado Pago pero sin
 * consultar a MP: marca el pago como
 * aprobado y dispara la acción.
 *
 * Uso:
 *   node scripts/simularPago.js REG-XXXXXXXXXXXXXXXX
 *     → acredita el alta de empresa
 *       pendiente de pago
 *
 *   node scripts/simularPago.js <id>
 *     → acredita el pago de
 *       suscripción con ese id
 *
 * NO usar en producción.
 * =====================================================
 */

require("dotenv").config();

const db = require("../config/db");

const registroService = require(
  "../services/registroService",
);

const pagosService = require(
  "../services/pagosService",
);

async function main() {
  if (
    process.env.NODE_ENV ===
    "production"
  ) {
    console.error(
      "Este script es solo para desarrollo.",
    );
    process.exit(1);
  }

  let referencia =
    process.argv[2];

  if (!referencia) {
    console.error(
      "Uso: node scripts/simularPago.js <referencia|id|ultimo>",
    );
    process.exit(1);
  }

  if (referencia === "ultimo") {
    const [pendientes] = await db.query(
      `
        SELECT referencia FROM pagos_registro
        WHERE estado = 'PENDIENTE'
        ORDER BY id DESC LIMIT 1
      `,
    );

    referencia = pendientes[0]?.referencia;

    if (!referencia) {
      console.error(
        "No hay registros pendientes de pago.",
      );
      process.exit(1);
    }

    console.log(
      "Último pendiente:",
      referencia,
    );
  }

  const mpIdFalso =
    "SIM-" +
    Date.now().toString(36);

  if (referencia.startsWith("REG-")) {
    const [rows] = await db.query(
      `
        SELECT monto FROM pagos_registro
        WHERE referencia = ?
      `,
      [referencia],
    );

    if (!rows[0]) {
      console.error(
        "No existe un registro pendiente con esa referencia.",
      );
      process.exit(1);
    }

    const resultado =
      await registroService.confirmarRegistro(
        referencia,
        mpIdFalso,
        "approved",
        Number(rows[0].monto),
      );

    console.log(
      "Resultado:",
      resultado,
    );
  } else {
    const pagoId = Number(referencia);

    const [rows] = await db.query(
      `
        SELECT monto FROM pagos_suscripcion
        WHERE id = ?
      `,
      [pagoId],
    );

    if (!rows[0]) {
      console.error(
        "No existe un pago de suscripción con ese id.",
      );
      process.exit(1);
    }

    const resultado =
      await pagosService.registrarPagoAprobado(
        pagoId,
        mpIdFalso,
        "approved",
        Number(rows[0].monto),
      );

    console.log(
      "Resultado:",
      resultado,
    );
  }

  await db.end();
}

main().catch((error) => {
  console.error(
    "Error:",
    error.message,
  );
  process.exit(1);
});
