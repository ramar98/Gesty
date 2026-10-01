const db = require(
  "../config/db",
);

const TIPOS_MANUALES = [
  "INGRESO",
  "EGRESO",
  "AJUSTE_INGRESO",
  "AJUSTE_EGRESO",
];

const TIPOS_MOVIMIENTO = [
  "VENTA",
  "ANULACION_VENTA",
  ...TIPOS_MANUALES,
];

const MEDIOS_PAGO = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "TARJETA",
  "OTRO",
];

/*
 * =====================================
 * HELPERS
 * =====================================
 */

function convertirId(valor) {
  const numero =
    Number(valor);

  if (
    !Number.isInteger(numero) ||
    numero <= 0
  ) {
    return null;
  }

  return numero;
}

function convertirMonto(
  valor,
  {
    permitirCero = false,
  } = {},
) {
  const numero =
    Number(valor);

  if (
    !Number.isFinite(numero)
  ) {
    return null;
  }

  if (
    permitirCero
      ? numero < 0
      : numero <= 0
  ) {
    return null;
  }

  return Number(
    numero.toFixed(2),
  );
}

function normalizarTexto(
  valor,
  maxLength = 500,
) {
  const texto =
    String(
      valor ?? "",
    ).trim();

  if (!texto) {
    return null;
  }

  return texto.slice(
    0,
    maxLength,
  );
}

function normalizarTipo(
  tipo,
) {
  return String(
    tipo ?? "",
  )
    .trim()
    .toUpperCase();
}

function normalizarMedioPago(
  medioPago,
) {
  if (
    medioPago === undefined ||
    medioPago === null ||
    medioPago === ""
  ) {
    return null;
  }

  return String(
    medioPago,
  )
    .trim()
    .toUpperCase();
}

/*
 * =====================================
 * OBTENER CAJA
 * =====================================
 */

async function obtenerCaja({
  connection = db,
  empresaId,
  cajaId = null,
  bloquear = false,
}) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const cajaIdNormalizado =
    cajaId
      ? convertirId(cajaId)
      : null;

  if (!empresaIdNormalizado) {
    const error =
      new Error(
        "La empresa no es válida.",
      );

    error.code =
      "EMPRESA_NO_VALIDA";

    throw error;
  }

  const condicionCaja =
    cajaIdNormalizado
      ? "AND c.id = ?"
      : "";

  const parametros = [
    empresaIdNormalizado,
  ];

  if (cajaIdNormalizado) {
    parametros.push(
      cajaIdNormalizado,
    );
  }

  const bloqueo =
    bloquear
      ? "FOR UPDATE"
      : "";

  const [rows] =
    await connection.query(
      `
        SELECT
          c.id,
          c.empresa_id,
          c.nombre,
          c.activa,
          c.created_at,
          c.updated_at

        FROM cajas c

        WHERE
          c.empresa_id = ?
          AND c.activa = 1

          ${condicionCaja}

        ORDER BY
          c.id ASC

        LIMIT 1

        ${bloqueo}
      `,
      parametros,
    );

  return (
    rows[0] ?? null
  );
}

/*
 * =====================================
 * TURNO ABIERTO
 * =====================================
 */

async function obtenerTurnoAbierto({
  connection = db,
  empresaId,
  cajaId,
  bloquear = false,
}) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const cajaIdNormalizado =
    convertirId(
      cajaId,
    );

  if (
    !empresaIdNormalizado ||
    !cajaIdNormalizado
  ) {
    return null;
  }

  const bloqueo =
    bloquear
      ? "FOR UPDATE"
      : "";

  const [rows] =
    await connection.query(
      `
        SELECT
          ct.id,
          ct.empresa_id,
          ct.caja_id,

          ct.usuario_apertura_id,
          ct.fecha_apertura,
          ct.saldo_inicial,

          ct.estado,

          ct.usuario_cierre_id,
          ct.fecha_cierre,

          ct.saldo_teorico,
          ct.efectivo_declarado,
          ct.diferencia,

          ct.observacion_apertura,
          ct.observacion_cierre,

          c.nombre AS caja_nombre,

          ua.nombre AS usuario_apertura_nombre,
          ua.apellido AS usuario_apertura_apellido,

          uc.nombre AS usuario_cierre_nombre,
          uc.apellido AS usuario_cierre_apellido

        FROM caja_turnos ct

        INNER JOIN cajas c
          ON c.id = ct.caja_id
          AND c.empresa_id =
            ct.empresa_id

        INNER JOIN usuarios ua
          ON ua.id =
            ct.usuario_apertura_id

        LEFT JOIN usuarios uc
          ON uc.id =
            ct.usuario_cierre_id

        WHERE
          ct.empresa_id = ?
          AND ct.caja_id = ?
          AND ct.estado = 'ABIERTA'

        ORDER BY
          ct.id DESC

        LIMIT 1

        ${bloqueo}
      `,
      [
        empresaIdNormalizado,
        cajaIdNormalizado,
      ],
    );

  return (
    rows[0] ?? null
  );
}

/*
 * =====================================
 * RESUMEN DEL TURNO
 * =====================================
 */

async function obtenerResumenTurno({
  connection = db,
  empresaId,
  turnoId,
}) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const turnoIdNormalizado =
    convertirId(
      turnoId,
    );

  if (
    !empresaIdNormalizado ||
    !turnoIdNormalizado
  ) {
    const error =
      new Error(
        "El turno no es válido.",
      );

    error.code =
      "TURNO_NO_VALIDO";

    throw error;
  }

  const [rows] =
    await connection.query(
      `
        SELECT

          COALESCE(
            SUM(
              CASE
                WHEN
                  tipo = 'VENTA'
                  AND medio_pago = 'EFECTIVO'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ventas_efectivo,

          COALESCE(
            SUM(
              CASE
                WHEN
                  tipo = 'VENTA'
                  AND medio_pago = 'TRANSFERENCIA'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ventas_transferencia,

          COALESCE(
            SUM(
              CASE
                WHEN
                  tipo = 'VENTA'
                  AND medio_pago = 'TARJETA'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ventas_tarjeta,

          COALESCE(
            SUM(
              CASE
                WHEN
                  tipo = 'VENTA'
                  AND medio_pago = 'OTRO'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ventas_otro,

          COALESCE(
            SUM(
              CASE
                WHEN tipo = 'INGRESO'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ingresos,

          COALESCE(
            SUM(
              CASE
                WHEN tipo = 'EGRESO'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS egresos,

          COALESCE(
            SUM(
              CASE
                WHEN tipo = 'AJUSTE_INGRESO'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ajustes_ingreso,

          COALESCE(
            SUM(
              CASE
                WHEN tipo = 'AJUSTE_EGRESO'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ajustes_egreso,

          COALESCE(
            SUM(
              CASE
                WHEN
                  tipo = 'ANULACION_VENTA'
                  AND medio_pago = 'EFECTIVO'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS anulaciones_efectivo,

          COALESCE(
            SUM(
              CASE
                WHEN tipo = 'VENTA'
                THEN monto
                ELSE 0
              END
            ),
            0
          ) AS ventas_totales,

          COUNT(*) AS cantidad_movimientos

        FROM caja_movimientos

        WHERE
          empresa_id = ?
          AND caja_turno_id = ?
      `,
      [
        empresaIdNormalizado,
        turnoIdNormalizado,
      ],
    );

  const fila =
    rows[0] ?? {};

  return {
    ventas_efectivo:
      Number(
        fila.ventas_efectivo ??
          0,
      ),

    ventas_transferencia:
      Number(
        fila.ventas_transferencia ??
          0,
      ),

    ventas_tarjeta:
      Number(
        fila.ventas_tarjeta ??
          0,
      ),

    ventas_otro:
      Number(
        fila.ventas_otro ??
          0,
      ),

    ingresos:
      Number(
        fila.ingresos ??
          0,
      ),

    egresos:
      Number(
        fila.egresos ??
          0,
      ),

    ajustes_ingreso:
      Number(
        fila.ajustes_ingreso ??
          0,
      ),

    ajustes_egreso:
      Number(
        fila.ajustes_egreso ??
          0,
      ),

    anulaciones_efectivo:
      Number(
        fila.anulaciones_efectivo ??
          0,
      ),

    ventas_totales:
      Number(
        fila.ventas_totales ??
          0,
      ),

    cantidad_movimientos:
      Number(
        fila.cantidad_movimientos ??
          0,
      ),
  };
}

/*
 * =====================================
 * CAJA ACTUAL
 * =====================================
 */

async function obtenerCajaActual(
  empresaId,
  cajaId = null,
) {
  const caja =
    await obtenerCaja({
      empresaId,
      cajaId,
    });

  if (!caja) {
    return {
      caja: null,
      turno: null,
      resumen: null,
    };
  }

  const turno =
    await obtenerTurnoAbierto({
      empresaId,
      cajaId:
        caja.id,
    });

  if (!turno) {
    return {
      caja,
      turno: null,
      resumen: null,
    };
  }

  const resumen =
    await obtenerResumenTurno({
      empresaId,
      turnoId:
        turno.id,
    });

  const saldoTeorico =
    Number(
      turno.saldo_inicial ??
        0,
    ) +
    resumen.ventas_efectivo +
    resumen.ingresos +
    resumen.ajustes_ingreso -
    resumen.egresos -
    resumen.ajustes_egreso -
    resumen.anulaciones_efectivo;

  return {
    caja,
    turno,
    resumen: {
      ...resumen,

      saldo_teorico:
        Number(
          saldoTeorico.toFixed(
            2,
          ),
        ),
    },
  };
}

/*
 * =====================================
 * ABRIR CAJA
 * =====================================
 */

async function abrirCaja({
  empresaId,
  usuarioId,
  cajaId = null,
  saldoInicial = 0,
  observacion = null,
}) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const usuarioIdNormalizado =
    convertirId(
      usuarioId,
    );

  const saldoInicialNormalizado =
    convertirMonto(
      saldoInicial,
      {
        permitirCero:
          true,
      },
    );

  if (
    !empresaIdNormalizado ||
    !usuarioIdNormalizado
  ) {
    const error =
      new Error(
        "Los datos de apertura no son válidos.",
      );

    error.code =
      "APERTURA_INVALIDA";

    throw error;
  }

  if (
    saldoInicialNormalizado ===
    null
  ) {
    const error =
      new Error(
        "El saldo inicial no es válido.",
      );

    error.code =
      "SALDO_INICIAL_INVALIDO";

    throw error;
  }

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    /*
     * Bloqueamos la caja.
     *
     * Esto evita que dos usuarios
     * intenten abrir la misma caja
     * al mismo tiempo.
     */

    const caja =
      await obtenerCaja({
        connection,
        empresaId:
          empresaIdNormalizado,
        cajaId,
        bloquear:
          true,
      });

    if (!caja) {
      const error =
        new Error(
          "No se encontró una caja activa para la empresa.",
        );

      error.code =
        "CAJA_NO_ENCONTRADA";

      throw error;
    }

    const turnoExistente =
      await obtenerTurnoAbierto({
        connection,
        empresaId:
          empresaIdNormalizado,
        cajaId:
          caja.id,
        bloquear:
          true,
      });

    if (turnoExistente) {
      const error =
        new Error(
          "La caja ya se encuentra abierta.",
        );

      error.code =
        "CAJA_YA_ABIERTA";

      throw error;
    }

    const [resultado] =
      await connection.query(
        `
          INSERT INTO caja_turnos
          (
            empresa_id,
            caja_id,
            usuario_apertura_id,
            saldo_inicial,
            estado,
            observacion_apertura
          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            'ABIERTA',
            ?
          )
        `,
        [
          empresaIdNormalizado,
          caja.id,
          usuarioIdNormalizado,
          saldoInicialNormalizado,
          normalizarTexto(
            observacion,
          ),
        ],
      );

    await connection.commit();

    return await obtenerCajaActual(
      empresaIdNormalizado,
      caja.id,
    );
  } catch (error) {
    await connection.rollback();

    throw error;
  } finally {
    connection.release();
  }
}

/*
 * =====================================
 * REGISTRAR MOVIMIENTO
 * =====================================
 *
 * Esta función también se reutilizará
 * desde ventasService.
 *
 * Si recibimos una conexión externa,
 * NO hacemos commit ni rollback.
 * Así venta + stock + caja quedan dentro
 * de la misma transacción.
 * =====================================
 */

async function registrarMovimiento({
  connection = null,
  empresaId,
  usuarioId,
  turnoId = null,
  tipo,
  medioPago = null,
  monto,
  descripcion = null,
  ventaId = null,
}) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const usuarioIdNormalizado =
    convertirId(
      usuarioId,
    );

  const turnoIdNormalizado =
    turnoId
      ? convertirId(
          turnoId,
        )
      : null;

  const ventaIdNormalizado =
    ventaId
      ? convertirId(
          ventaId,
        )
      : null;

  const tipoNormalizado =
    normalizarTipo(
      tipo,
    );

  const medioPagoNormalizado =
    normalizarMedioPago(
      medioPago,
    );

  const montoNormalizado =
    convertirMonto(
      monto,
    );

  if (
    !empresaIdNormalizado ||
    !usuarioIdNormalizado
  ) {
    const error =
      new Error(
        "La empresa o el usuario no son válidos.",
      );

    error.code =
      "MOVIMIENTO_INVALIDO";

    throw error;
  }

  if (
    !TIPOS_MOVIMIENTO.includes(
      tipoNormalizado,
    )
  ) {
    const error =
      new Error(
        "El tipo de movimiento de caja no es válido.",
      );

    error.code =
      "TIPO_MOVIMIENTO_INVALIDO";

    throw error;
  }

  if (
    montoNormalizado ===
    null
  ) {
    const error =
      new Error(
        "El monto debe ser mayor que cero.",
      );

    error.code =
      "MONTO_INVALIDO";

    throw error;
  }

  if (
    medioPagoNormalizado &&
    !MEDIOS_PAGO.includes(
      medioPagoNormalizado,
    )
  ) {
    const error =
      new Error(
        "El medio de pago no es válido.",
      );

    error.code =
      "MEDIO_PAGO_INVALIDO";

    throw error;
  }

  const conexion =
    connection ??
    await db.getConnection();

  const conexionPropia =
    !connection;

  try {
    if (conexionPropia) {
      await conexion.beginTransaction();
    }

    let turno;

    if (turnoIdNormalizado) {
      const [rows] =
        await conexion.query(
          `
            SELECT
              ct.id,
              ct.caja_id,
              ct.estado

            FROM caja_turnos ct

            WHERE
              ct.id = ?
              AND ct.empresa_id = ?

            LIMIT 1

            FOR UPDATE
          `,
          [
            turnoIdNormalizado,
            empresaIdNormalizado,
          ],
        );

      turno =
        rows[0] ?? null;

      if (
        !turno ||
        turno.estado !==
          "ABIERTA"
      ) {
        const error =
          new Error(
            "El turno de caja no está abierto.",
          );

        error.code =
          "CAJA_CERRADA";

        throw error;
      }
    } else {
      const caja =
        await obtenerCaja({
          connection:
            conexion,
          empresaId:
            empresaIdNormalizado,
          bloquear:
            true,
        });

      if (!caja) {
        const error =
          new Error(
            "No existe una caja activa.",
          );

        error.code =
          "CAJA_NO_ENCONTRADA";

        throw error;
      }

      turno =
        await obtenerTurnoAbierto({
          connection:
            conexion,
          empresaId:
            empresaIdNormalizado,
          cajaId:
            caja.id,
          bloquear:
            true,
        });

      if (!turno) {
        const error =
          new Error(
            "No hay una caja abierta.",
          );

        error.code =
          "CAJA_CERRADA";

        throw error;
      }
    }

    const [resultado] =
      await conexion.query(
        `
          INSERT INTO caja_movimientos
          (
            empresa_id,
            caja_turno_id,
            tipo,
            medio_pago,
            monto,
            descripcion,
            venta_id,
            usuario_id
          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
        [
          empresaIdNormalizado,
          turno.id,
          tipoNormalizado,
          medioPagoNormalizado,
          montoNormalizado,
          normalizarTexto(
            descripcion,
            255,
          ),
          ventaIdNormalizado,
          usuarioIdNormalizado,
        ],
      );

    if (conexionPropia) {
      await conexion.commit();
    }

    return {
      id:
        resultado.insertId,

      empresa_id:
        empresaIdNormalizado,

      caja_turno_id:
        turno.id,

      tipo:
        tipoNormalizado,

      medio_pago:
        medioPagoNormalizado,

      monto:
        montoNormalizado,

      descripcion:
        normalizarTexto(
          descripcion,
          255,
        ),

      venta_id:
        ventaIdNormalizado,

      usuario_id:
        usuarioIdNormalizado,
    };
  } catch (error) {
    if (conexionPropia) {
      await conexion.rollback();
    }

    throw error;
  } finally {
    if (conexionPropia) {
      conexion.release();
    }
  }
}

/*
 * =====================================
 * CERRAR CAJA
 * =====================================
 */

async function cerrarCaja({
  empresaId,
  usuarioId,
  turnoId,
  efectivoDeclarado,
  observacion = null,
}) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const usuarioIdNormalizado =
    convertirId(
      usuarioId,
    );

  const turnoIdNormalizado =
    convertirId(
      turnoId,
    );

  const efectivoNormalizado =
    convertirMonto(
      efectivoDeclarado,
      {
        permitirCero:
          true,
      },
    );

  if (
    !empresaIdNormalizado ||
    !usuarioIdNormalizado ||
    !turnoIdNormalizado
  ) {
    const error =
      new Error(
        "Los datos de cierre no son válidos.",
      );

    error.code =
      "CIERRE_INVALIDO";

    throw error;
  }

  if (
    efectivoNormalizado ===
    null
  ) {
    const error =
      new Error(
        "El efectivo declarado no es válido.",
      );

    error.code =
      "EFECTIVO_INVALIDO";

    throw error;
  }

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] =
      await connection.query(
        `
          SELECT
            id,
            empresa_id,
            caja_id,
            saldo_inicial,
            estado

          FROM caja_turnos

          WHERE
            id = ?
            AND empresa_id = ?

          LIMIT 1

          FOR UPDATE
        `,
        [
          turnoIdNormalizado,
          empresaIdNormalizado,
        ],
      );

    const turno =
      rows[0] ?? null;

    if (!turno) {
      const error =
        new Error(
          "El turno de caja no existe.",
        );

      error.code =
        "TURNO_NO_ENCONTRADO";

      throw error;
    }

    if (
      turno.estado !==
      "ABIERTA"
    ) {
      const error =
        new Error(
          "La caja ya se encuentra cerrada.",
        );

      error.code =
        "CAJA_YA_CERRADA";

      throw error;
    }

    const resumen =
      await obtenerResumenTurno({
        connection,
        empresaId:
          empresaIdNormalizado,
        turnoId:
          turnoIdNormalizado,
      });

    const saldoTeorico =
      Number(
        turno.saldo_inicial ??
          0,
      ) +
      resumen.ventas_efectivo +
      resumen.ingresos +
      resumen.ajustes_ingreso -
      resumen.egresos -
      resumen.ajustes_egreso -
      resumen.anulaciones_efectivo;

    const diferencia =
      efectivoNormalizado -
      saldoTeorico;

    await connection.query(
      `
        UPDATE caja_turnos

        SET
          estado = 'CERRADA',

          usuario_cierre_id = ?,

          fecha_cierre =
            CURRENT_TIMESTAMP,

          saldo_teorico = ?,

          efectivo_declarado = ?,

          diferencia = ?,

          observacion_cierre = ?

        WHERE
          id = ?
          AND empresa_id = ?
          AND estado = 'ABIERTA'
      `,
      [
        usuarioIdNormalizado,

        Number(
          saldoTeorico.toFixed(
            2,
          ),
        ),

        efectivoNormalizado,

        Number(
          diferencia.toFixed(
            2,
          ),
        ),

        normalizarTexto(
          observacion,
        ),

        turnoIdNormalizado,
        empresaIdNormalizado,
      ],
    );

    await connection.commit();

    return await obtenerTurnoPorId(
      empresaIdNormalizado,
      turnoIdNormalizado,
    );
  } catch (error) {
    await connection.rollback();

    throw error;
  } finally {
    connection.release();
  }
}

/*
 * =====================================
 * TURNO POR ID
 * =====================================
 */

async function obtenerTurnoPorId(
  empresaId,
  turnoId,
) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const turnoIdNormalizado =
    convertirId(
      turnoId,
    );

  const [turnos] =
    await db.query(
      `
        SELECT
          ct.*,

          c.nombre AS caja_nombre,

          ua.nombre AS usuario_apertura_nombre,
          ua.apellido AS usuario_apertura_apellido,

          uc.nombre AS usuario_cierre_nombre,
          uc.apellido AS usuario_cierre_apellido

        FROM caja_turnos ct

        INNER JOIN cajas c
          ON c.id =
            ct.caja_id

        INNER JOIN usuarios ua
          ON ua.id =
            ct.usuario_apertura_id

        LEFT JOIN usuarios uc
          ON uc.id =
            ct.usuario_cierre_id

        WHERE
          ct.id = ?
          AND ct.empresa_id = ?

        LIMIT 1
      `,
      [
        turnoIdNormalizado,
        empresaIdNormalizado,
      ],
    );

  const turno =
    turnos[0] ?? null;

  if (!turno) {
    return null;
  }

  const [movimientos] =
    await db.query(
      `
        SELECT
          cm.id,
          cm.tipo,
          cm.medio_pago,
          cm.monto,
          cm.descripcion,
          cm.venta_id,
          cm.usuario_id,
          cm.created_at,

          u.nombre AS usuario_nombre,
          u.apellido AS usuario_apellido

        FROM caja_movimientos cm

        INNER JOIN usuarios u
          ON u.id =
            cm.usuario_id

        WHERE
          cm.empresa_id = ?
          AND cm.caja_turno_id = ?

        ORDER BY
          cm.created_at DESC,
          cm.id DESC
      `,
      [
        empresaIdNormalizado,
        turnoIdNormalizado,
      ],
    );

  const resumen =
    await obtenerResumenTurno({
      empresaId:
        empresaIdNormalizado,
      turnoId:
        turnoIdNormalizado,
    });

  return {
    ...turno,
    resumen,
    movimientos,
  };
}

/*
 * =====================================
 * HISTORIAL
 * =====================================
 */

async function obtenerHistorial(
  empresaId,
  {
    limite = 50,
  } = {},
) {
  const empresaIdNormalizado =
    convertirId(
      empresaId,
    );

  const limiteNormalizado =
    Math.min(
      Math.max(
        Number(limite) ||
          50,
        1,
      ),
      200,
    );

  const [rows] =
    await db.query(
      `
        SELECT
          ct.id,
          ct.caja_id,
          ct.fecha_apertura,
          ct.fecha_cierre,
          ct.saldo_inicial,
          ct.saldo_teorico,
          ct.efectivo_declarado,
          ct.diferencia,
          ct.estado,

          c.nombre AS caja_nombre,

          ua.nombre AS usuario_apertura_nombre,
          ua.apellido AS usuario_apertura_apellido,

          uc.nombre AS usuario_cierre_nombre,
          uc.apellido AS usuario_cierre_apellido

        FROM caja_turnos ct

        INNER JOIN cajas c
          ON c.id =
            ct.caja_id

        INNER JOIN usuarios ua
          ON ua.id =
            ct.usuario_apertura_id

        LEFT JOIN usuarios uc
          ON uc.id =
            ct.usuario_cierre_id

        WHERE
          ct.empresa_id = ?

        ORDER BY
          ct.fecha_apertura DESC,
          ct.id DESC

        LIMIT ?
      `,
      [
        empresaIdNormalizado,
        limiteNormalizado,
      ],
    );

  return rows;
}

module.exports = {
  TIPOS_MANUALES,
  TIPOS_MOVIMIENTO,
  MEDIOS_PAGO,

  obtenerCajaActual,
  abrirCaja,
  registrarMovimiento,
  cerrarCaja,
  obtenerTurnoPorId,
  obtenerHistorial,
};