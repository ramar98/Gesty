const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const empresasService = require("./empresasService");
const codigosService = require("./codigosService");
const pagosService = require("./pagosService");
const suscripcionesService = require("./suscripcionesService");

const errorRegistro = (message, code) => Object.assign(new Error(message), { code });

const iniciarRegistro = async (datos) => {
  const codigo = datos.codigoPromocional
    ? await codigosService.validarCodigo(datos.codigoPromocional)
    : null;
  const meses = codigo?.tipo === "MESES_GRATIS" ? Number(codigo.meses_gratis) : 1;
  const descuento = codigo?.tipo === "MESES_GRATIS" ? 1
    : codigo?.tipo === "DESCUENTO" ? Number(codigo.descuento_porcentaje) / 100 : 0;
  const montoOriginal = suscripcionesService.PRECIO_MENSUAL * meses;
  const monto = Math.round(montoOriginal * (1 - descuento) * 100) / 100;
  const referencia = `REG-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
  const { password, ...administrador } = datos.administrador;
  administrador.passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    `INSERT INTO pagos_registro (referencia, datos, meses, monto, codigo_id) VALUES (?, ?, ?, ?, ?)`,
    [referencia, JSON.stringify({ empresa: datos.empresa, administrador }), meses, monto, codigo?.id ?? null],
  );

  const pago = {
    referencia, monto, monto_original: montoOriginal, codigo: codigo?.codigo ?? null,
    meses, gratis: monto === 0,
  };
  if (monto === 0) {
    await confirmarRegistro(referencia, `GRATIS-${referencia}`, "approved", 0);
  } else {
    try {
      const orden = await pagosService.crearOrdenQr({
        referencia, titulo: `Gesty - Alta de empresa (${meses} mes${meses > 1 ? "es" : ""})`, monto,
      });
      await db.query("UPDATE pagos_registro SET mp_preference_id = ? WHERE referencia = ?", [orden.orden_id, referencia]);
      pago.qr_imagen = orden.qr_imagen;
      pago.expira_en = orden.expira_en;
    } catch (error) {
      await db.query("UPDATE pagos_registro SET estado = 'RECHAZADO' WHERE referencia = ? AND estado = 'PENDIENTE'", [referencia]);
      throw error;
    }
  }
  return { requiere_pago: true, pago };
};

// El bloqueo y la transacción cubren acreditación, empresa, administrador y código.
// El webhook y la verificación de la pantalla pueden llegar al mismo tiempo.
const confirmarRegistro = async (referencia, mpPaymentId, estadoMp, montoMp) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT id, datos, meses, monto, codigo_id, empresa_id, estado FROM pagos_registro WHERE referencia = ? FOR UPDATE",
      [referencia],
    );
    const registro = rows[0];
    if (!registro) throw errorRegistro("El registro indicado no existe.", "REGISTRO_NO_ENCONTRADO");
    if (registro.empresa_id) {
      await connection.commit();
      return { procesado: false, creada: true, estado: "APROBADO" };
    }
    if (registro.estado !== "APROBADO") {
      const estado = estadoMp === "approved" ? "APROBADO"
        : ["rejected", "cancelled"].includes(estadoMp) ? "RECHAZADO" : "PENDIENTE";
      if (estado === "APROBADO" &&
          (!Number.isFinite(montoMp) || Math.round(Number(registro.monto) * 100) !== Math.round(montoMp * 100))) {
        throw errorRegistro("El importe acreditado no coincide con el registro.", "MONTO_INVALIDO");
      }
      await connection.query(
        `UPDATE pagos_registro SET estado = ?, mp_payment_id = ?,
         pagado_at = CASE WHEN ? = 'APROBADO' THEN NOW() ELSE pagado_at END WHERE id = ?`,
        [estado, String(mpPaymentId), estado, registro.id],
      );
      if (estado !== "APROBADO") {
        await connection.commit();
        return { procesado: true, creada: false, estado };
      }
    }
    const datos = typeof registro.datos === "string" ? JSON.parse(registro.datos) : registro.datos;
    if (registro.codigo_id) await codigosService.consumirCodigo(registro.codigo_id, connection);
    const resultado = await empresasService.crearEmpresa({
      empresa: datos.empresa, administrador: datos.administrador, mesesPagados: Number(registro.meses),
    }, connection);
    await connection.query("UPDATE pagos_registro SET empresa_id = ? WHERE id = ?", [resultado.empresa.id, registro.id]);
    await connection.commit();
    return { procesado: true, creada: true, estado: "APROBADO" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const verificarRegistro = async (referencia) => {
  if (!/^REG-(?:[A-F0-9]{16}|[A-F0-9]{32})$/.test(referencia)) {
    throw errorRegistro("El registro indicado no existe.", "REGISTRO_NO_ENCONTRADO");
  }
  const [rows] = await db.query("SELECT estado, empresa_id FROM pagos_registro WHERE referencia = ?", [referencia]);
  const registro = rows[0];
  if (!registro) throw errorRegistro("El registro indicado no existe.", "REGISTRO_NO_ENCONTRADO");
  if (registro.empresa_id) return { creada: true, estado: "APROBADO" };
  if (registro.estado === "APROBADO") return confirmarRegistro(referencia);
  const pago = await pagosService.buscarPagoPorReferencia(referencia);
  if (!pago) return { creada: false, estado: registro.estado === "RECHAZADO" ? "RECHAZADO" : "SIN_ACREDITAR" };
  return confirmarRegistro(referencia, pago.id, pago.status, Number(pago.transaction_amount));
};

module.exports = { iniciarRegistro, confirmarRegistro, verificarRegistro };
