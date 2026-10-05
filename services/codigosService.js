const crypto = require("crypto");

const db = require("../config/db");

/*
 * =====================================
 * GENERAR CÓDIGO ALEATORIO
 * =====================================
 */

function generarCodigo() {
  const parte = () =>
    crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase();

  return `GESTY-${parte()}-${parte()}`;
}

function normalizarCodigo(valor) {
  return String(valor ?? "")
    .trim()
    .toUpperCase();
}

/*
 * =====================================
 * CREAR CÓDIGO (superadmin)
 * =====================================
 */

const crearCodigo = async ({
  codigo,
  tipo,
  meses_gratis,
  descuento_porcentaje,
  usos_maximos,
  expira_en,
}) => {
  const tipoNormalizado = String(
    tipo ?? "",
  )
    .trim()
    .toUpperCase();

  if (
    ![
      "MESES_GRATIS",
      "DESCUENTO",
    ].includes(tipoNormalizado)
  ) {
    const error = new Error(
      "El tipo de código debe ser MESES_GRATIS o DESCUENTO.",
    );

    error.code = "TIPO_INVALIDO";

    throw error;
  }

  const meses =
    Number(meses_gratis);

  const porcentaje = Number(
    descuento_porcentaje,
  );

  if (
    tipoNormalizado ===
      "MESES_GRATIS" &&
    (!Number.isInteger(meses) ||
      meses <= 0 ||
      meses > 36)
  ) {
    const error = new Error(
      "Los meses gratis deben ser un número entre 1 y 36.",
    );

    error.code = "MESES_INVALIDOS";

    throw error;
  }

  if (
    tipoNormalizado ===
      "DESCUENTO" &&
    (!Number.isFinite(porcentaje) ||
      porcentaje <= 0 ||
      porcentaje > 100)
  ) {
    const error = new Error(
      "El descuento debe ser un porcentaje entre 1 y 100.",
    );

    error.code =
      "DESCUENTO_INVALIDO";

    throw error;
  }

  const usosMaximos = Number(
    usos_maximos ?? 1,
  );

  if (
    !Number.isInteger(usosMaximos) ||
    usosMaximos <= 0
  ) {
    const error = new Error(
      "Los usos máximos deben ser un número mayor a 0.",
    );

    error.code = "USOS_INVALIDOS";

    throw error;
  }

  const codigoFinal =
    normalizarCodigo(codigo) ||
    generarCodigo();

  const [result] = await db.query(
    `
      INSERT INTO codigos_promocionales
      (
        codigo,
        tipo,
        meses_gratis,
        descuento_porcentaje,
        usos_maximos,
        expira_en
      )

      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      codigoFinal,
      tipoNormalizado,
      tipoNormalizado ===
      "MESES_GRATIS"
        ? meses
        : null,
      tipoNormalizado === "DESCUENTO"
        ? porcentaje
        : null,
      usosMaximos,
      expira_en || null,
    ],
  );

  return {
    id: Number(result.insertId),
    codigo: codigoFinal,
    tipo: tipoNormalizado,
  };
};

/*
 * =====================================
 * VALIDAR CÓDIGO (sin consumir)
 * =====================================
 */

const validarCodigo = async (
  codigo,
) => {
  const codigoNormalizado =
    normalizarCodigo(codigo);

  if (!codigoNormalizado) {
    const error = new Error(
      "Ingresá un código.",
    );

    error.code = "CODIGO_VACIO";

    throw error;
  }

  const [rows] = await db.query(
    `
      SELECT
        id,
        codigo,
        tipo,
        meses_gratis,
        descuento_porcentaje,
        usos_maximos,
        usos,
        activo,
        expira_en

      FROM codigos_promocionales

      WHERE codigo = ?

      LIMIT 1
    `,
    [codigoNormalizado],
  );

  const registro = rows[0];

  if (!registro) {
    const error = new Error(
      "El código no existe.",
    );

    error.code =
      "CODIGO_NO_EXISTE";

    throw error;
  }

  if (!registro.activo) {
    const error = new Error(
      "El código está desactivado.",
    );

    error.code =
      "CODIGO_INACTIVO";

    throw error;
  }

  if (
    registro.expira_en &&
    new Date(registro.expira_en) <
      new Date()
  ) {
    const error = new Error(
      "El código está vencido.",
    );

    error.code = "CODIGO_VENCIDO";

    throw error;
  }

  if (
    Number(registro.usos) >=
    Number(registro.usos_maximos)
  ) {
    const error = new Error(
      "El código ya no tiene usos disponibles.",
    );

    error.code = "CODIGO_AGOTADO";

    throw error;
  }

  return registro;
};

/*
 * =====================================
 * CONSUMIR UN USO
 *
 * Atómico: solo incrementa si sigue
 * activo y con usos disponibles.
 * =====================================
 */

const consumirCodigo = async (
  codigoId,
  connection = db,
) => {
  const [result] =
    await connection.query(
      `
        UPDATE codigos_promocionales

        SET usos = usos + 1

        WHERE
          id = ?
          AND activo = TRUE
          AND usos < usos_maximos
      `,
      [codigoId],
    );

  if (result.affectedRows === 0) {
    const error = new Error(
      "El código ya no tiene usos disponibles.",
    );

    error.code = "CODIGO_AGOTADO";

    throw error;
  }
};

/*
 * =====================================
 * LISTAR / DESACTIVAR (superadmin)
 * =====================================
 */

const listarCodigos = async () => {
  const [rows] = await db.query(
    `
      SELECT
        id,
        codigo,
        tipo,
        meses_gratis,
        descuento_porcentaje,
        usos_maximos,
        usos,
        activo,
        expira_en,
        created_at

      FROM codigos_promocionales

      ORDER BY created_at DESC
    `,
  );

  return rows;
};

const desactivarCodigo = async (
  id,
) => {
  const [result] = await db.query(
    `
      UPDATE codigos_promocionales

      SET activo = FALSE

      WHERE id = ?
    `,
    [id],
  );

  if (result.affectedRows === 0) {
    const error = new Error(
      "El código no existe.",
    );

    error.code =
      "CODIGO_NO_EXISTE";

    throw error;
  }
};

module.exports = {
  crearCodigo,
  validarCodigo,
  consumirCodigo,
  listarCodigos,
  desactivarCodigo,
};
