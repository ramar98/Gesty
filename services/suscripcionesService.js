const db = require("../config/db");

/*
 * =====================================
 * CONFIGURACIÓN
 * =====================================
 */

const PRECIO_MENSUAL = Number(
  process.env
    .PRECIO_SUSCRIPCION_MENSUAL ||
    10000,
);

const TRIAL_DIAS = Number(
  process.env.SUSCRIPCION_TRIAL_DIAS ||
    0,
);

/*
 * =====================================
 * ESTADO DE SUSCRIPCIÓN
 * =====================================
 */

const obtenerEstado = async (
  empresaId,
) => {
  const [rows] = await db.query(
    `
      SELECT
        id,
        nombre,
        plan,
        activo,
        suscripcion_vence

      FROM empresas

      WHERE id = ?

      LIMIT 1
    `,
    [empresaId],
  );

  const empresa = rows[0];

  if (!empresa) {
    const error = new Error(
      "La empresa no existe.",
    );

    error.code =
      "EMPRESA_NO_ENCONTRADA";

    throw error;
  }

  const vence = empresa.suscripcion_vence
    ? new Date(
        empresa.suscripcion_vence,
      )
    : null;

  const ahora = new Date();

  const diasRestantes = vence
    ? Math.ceil(
        (vence.getTime() -
          ahora.getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : 0;

  return {
    activa:
      Boolean(vence) &&
      vence > ahora,
    suscripcion_vence: vence,
    dias_restantes:
      diasRestantes > 0
        ? diasRestantes
        : 0,
    precio_mensual:
      PRECIO_MENSUAL,
    empresa: {
      id: empresa.id,
      nombre: empresa.nombre,
      plan: empresa.plan,
    },
  };
};

/*
 * =====================================
 * ESTÁ AL DÍA (middleware)
 * =====================================
 */

const estaAlDia = async (
  empresaId,
) => {
  const [rows] = await db.query(
    `
      SELECT
        suscripcion_vence

      FROM empresas

      WHERE
        id = ?
        AND suscripcion_vence
          IS NOT NULL
        AND suscripcion_vence
          > NOW()

      LIMIT 1
    `,
    [empresaId],
  );

  return rows.length > 0;
};

/*
 * =====================================
 * EXTENDER SUSCRIPCIÓN
 *
 * Si está vigente, suma desde el
 * vencimiento actual. Si venció o
 * nunca pagó, suma desde ahora.
 * =====================================
 */

const extender = async (
  empresaId,
  meses,
  connection = db,
) => {
  const mesesEntero = Number(meses);

  if (
    !Number.isInteger(
      mesesEntero,
    ) ||
    mesesEntero <= 0 ||
    mesesEntero > 36
  ) {
    const error = new Error(
      "La cantidad de meses no es válida.",
    );

    error.code =
      "MESES_INVALIDOS";

    throw error;
  }

  const [result] =
    await connection.query(
      `
        UPDATE empresas

        SET suscripcion_vence =
          DATE_ADD(
            GREATEST(
              COALESCE(
                suscripcion_vence,
                NOW()
              ),
              NOW()
            ),
            INTERVAL ${mesesEntero} MONTH
          )

        WHERE id = ?
      `,
      [empresaId],
    );

  if (result.affectedRows === 0) {
    const error = new Error(
      "La empresa no existe.",
    );

    error.code =
      "EMPRESA_NO_ENCONTRADA";

    throw error;
  }
};

/*
 * =====================================
 * TRIAL INICIAL (alta de empresa)
 *
 * Si SUSCRIPCION_TRIAL_DIAS > 0 la
 * empresa arranca con ese período de
 * gracia; si no, queda sin vigencia
 * y pasa directo al paywall.
 * =====================================
 */

const aplicarVencimientoInicial =
  async (
    empresaId,
    connection = db,
  ) => {
    const dias = Number(TRIAL_DIAS);

    if (
      !Number.isInteger(dias) ||
      dias <= 0
    ) {
      return;
    }

    await connection.query(
      `
        UPDATE empresas

        SET suscripcion_vence =
          DATE_ADD(
            NOW(),
            INTERVAL ${dias} DAY
          )

        WHERE id = ?
      `,
      [empresaId],
    );
  };

/*
 * =====================================
 * LISTADO PARA SUPERADMIN
 * =====================================
 */

const listarEmpresas = async () => {
  const [rows] = await db.query(
    `
      SELECT
        e.id,
        e.nombre,
        e.email,
        e.plan,
        e.activo,
        e.suscripcion_vence,
        e.created_at,

        (
          SELECT COUNT(*)
          FROM usuarios u
          WHERE u.empresa_id = e.id
        ) AS usuarios,

        (
          SELECT COUNT(*)
          FROM pagos_suscripcion p
          WHERE
            p.empresa_id = e.id
            AND p.estado = 'APROBADO'
        ) AS pagos_aprobados

      FROM empresas e

      ORDER BY
        e.created_at DESC
    `,
  );

  const ahora = new Date();

  return rows.map((empresa) => {
    const vence =
      empresa.suscripcion_vence
        ? new Date(
            empresa.suscripcion_vence,
          )
        : null;

    return {
      ...empresa,

      suscripcion_activa:
        Boolean(vence) &&
        vence > ahora,
    };
  });
};

/*
 * =====================================
 * MÉTRICAS DE PLATAFORMA (SUPERADMIN)
 *
 * Indicadores globales para el
 * dashboard del superadmin: no es un
 * negocio, es el panel de control de
 * la plataforma.
 * =====================================
 */

const obtenerMetricas = async () => {
  const [empresas] = await db.query(
    `
      SELECT
        COUNT(*) AS total,

        SUM(
          suscripcion_vence IS NOT NULL
          AND suscripcion_vence > NOW()
        ) AS activas,

        SUM(
          suscripcion_vence IS NULL
          OR suscripcion_vence <= NOW()
        ) AS vencidas,

        SUM(
          created_at >= NOW() - INTERVAL 30 DAY
        ) AS altas_30d

      FROM empresas

      WHERE plan <> 'INTERNA'
    `,
  );

  const [recaudacion] = await db.query(
    `
      SELECT
        COALESCE(SUM(monto), 0) AS total,

        COALESCE(
          SUM(
            CASE
              WHEN pagado_at >=
                DATE_FORMAT(
                  NOW(), '%Y-%m-01'
                )
                THEN monto
              ELSE 0
            END
          ),
          0
        ) AS del_mes

      FROM (
        SELECT monto, pagado_at
        FROM pagos_suscripcion
        WHERE estado = 'APROBADO'

        UNION ALL

        SELECT monto, pagado_at
        FROM pagos_registro
        WHERE estado = 'APROBADO'
      ) pagos
    `,
  );

  const [pendientes] = await db.query(
    `
      SELECT
        (
          SELECT COUNT(*)
          FROM pagos_registro
          WHERE estado = 'PENDIENTE'
        ) AS registros_pendientes,

        (
          SELECT COUNT(*)
          FROM pagos_suscripcion
          WHERE estado = 'PENDIENTE'
        ) AS suscripciones_pendientes
    `,
  );

  const [codigos] = await db.query(
    `
      SELECT COUNT(*) AS activos

      FROM codigos_promocionales

      WHERE
        activo = 1
        AND usos < usos_maximos
    `,
  );

  const [ultimas] = await db.query(
    `
      SELECT
        nombre,
        plan,
        suscripcion_vence,
        created_at

      FROM empresas

      WHERE plan <> 'INTERNA'

      ORDER BY created_at DESC

      LIMIT 5
    `,
  );

  return {
    empresas: empresas[0],
    recaudacion: recaudacion[0],
    pendientes: pendientes[0],
    codigos_activos:
      Number(
        codigos[0]?.activos ?? 0,
      ),
    ultimas_empresas: ultimas,
  };
};

module.exports = {
  PRECIO_MENSUAL,
  obtenerEstado,
  estaAlDia,
  extender,
  aplicarVencimientoInicial,
  listarEmpresas,
  obtenerMetricas,
};
