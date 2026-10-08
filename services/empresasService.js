const bcrypt = require("bcryptjs");
const db = require("../config/db");

const suscripcionesService = require(
  "./suscripcionesService",
);

const codigosService = require(
  "./codigosService",
);

/*
 * =====================================
 * BUSCAR ROL ADMINISTRADOR
 * =====================================
 */

async function obtenerRolAdministrador(
  connection,
) {
  const [rows] =
    await connection.query(
      `
        SELECT
          id,
          nombre

        FROM roles

        WHERE LOWER(nombre) =
              LOWER('Administrador')

        LIMIT 1
      `,
    );

  if (rows.length === 0) {
    const error = new Error(
      "No existe el rol Administrador.",
    );

    error.code =
      "ROL_ADMIN_NO_ENCONTRADO";

    throw error;
  }

  return rows[0];
}

/*
 * =====================================
 * CREAR EMPRESA
 * =====================================
 */

const crearEmpresa = async ({
  empresa,
  administrador,
  codigoPromocional,
  mesesPagados,
}, connectionExterna = null) => {
  const connection =
    connectionExterna ?? await db.getConnection();

  try {
    if (!connectionExterna) await connection.beginTransaction();

    /*
     * =================================
     * ROL ADMINISTRADOR
     * =================================
     */

    const rolAdministrador =
      await obtenerRolAdministrador(
        connection,
      );

    /*
     * =================================
     * CREAR EMPRESA
     * =================================
     */

    const [empresaResult] =
      await connection.query(
        `
          INSERT INTO empresas
          (
            nombre,
            cuit,
            email,
            telefono,
            plan,
            activo
          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            TRUE
          )
        `,
        [
          empresa.nombre,
          empresa.cuit,
          empresa.email,
          empresa.telefono,
          empresa.plan,
        ],
      );

    const empresaId =
      Number(
        empresaResult.insertId,
      );

    /*
     * =================================
     * VERIFICAR DUPLICADOS
     * =================================
     *
     * Actualmente usuario/email son
     * únicos por empresa.
     *
     * Como la empresa acaba de crearse,
     * normalmente no puede existir
     * duplicado, pero dejamos la
     * comprobación igualmente.
     */

    const [duplicados] =
      await connection.query(
        `
          SELECT id

          FROM usuarios

          WHERE empresa_id = ?

            AND (
              LOWER(usuario) =
                LOWER(?)

              OR

              LOWER(email) =
                LOWER(?)
            )

          LIMIT 1
        `,
        [
          empresaId,
          administrador.usuario,
          administrador.email,
        ],
      );

    if (
      duplicados.length > 0
    ) {
      const error = new Error(
        "El usuario administrador ya existe.",
      );

      error.code =
        "USUARIO_DUPLICADO";

      throw error;
    }

    /*
     * =================================
     * PASSWORD
     * =================================
     */

    const passwordHash =
      administrador.passwordHash ??
      (await bcrypt.hash(
        administrador.password,
        12,
      ));

    /*
     * =================================
     * CREAR ADMINISTRADOR
     * =================================
     */

    const [usuarioResult] =
      await connection.query(
        `
          INSERT INTO usuarios
          (
            empresa_id,
            nombre,
            apellido,
            usuario,
            email,
            password,
            rol_id,
            activo
          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            TRUE
          )
        `,
        [
          empresaId,
          administrador.nombre,
          administrador.apellido,
          administrador.usuario,
          administrador.email,
          passwordHash,
          rolAdministrador.id,
        ],
      );

    const usuarioId =
      Number(
        usuarioResult.insertId,
      );

    /*
     * =================================
     * CONFIGURACIÓN INICIAL
     * =================================
     */

    await connection.query(
      `
        INSERT INTO configuracion_negocio
        (
          empresa_id,
          nombre_negocio,
          moneda,
          porcentaje_iva,
          stock_minimo_predeterminado,
          encabezado_comprobante,
          pie_comprobante
        )

        VALUES (
          ?,
          ?,
          'ARS',
          21.00,
          1,
          ?,
          'Gracias por tu compra'
        )
      `,
      [
        empresaId,
        empresa.nombre,
        empresa.nombre,
      ],
    );

    /*
     * =================================
     * SUSCRIPCIÓN INICIAL
     *
     * mesesPagados: la empresa se creó
     * después de un pago acreditado.
     *
     * Con código MESES_GRATIS arranca
     * con meses gratis; si no hay
     * código aplica el trial
     * configurado (0 días = paywall
     * inmediato).
     * =================================
     */

    if (
      Number.isInteger(mesesPagados) &&
      mesesPagados > 0
    ) {
      await suscripcionesService.extender(
        empresaId,
        mesesPagados,
        connection,
      );
    } else if (codigoPromocional) {
      const codigo =
        await codigosService.validarCodigo(
          codigoPromocional,
        );

      if (
        codigo.tipo !== "MESES_GRATIS"
      ) {
        const error = new Error(
          "Este código es de descuento: usalo al pagar tu suscripción.",
        );

        error.code =
          "CODIGO_TIPO_INCORRECTO";

        throw error;
      }

      await codigosService.consumirCodigo(
        codigo.id,
        connection,
      );

      await suscripcionesService.extender(
        empresaId,
        codigo.meses_gratis,
        connection,
      );
    } else {
      await suscripcionesService.aplicarVencimientoInicial(
        empresaId,
        connection,
      );
    }

    /*
     * =================================
     * COMMIT
     * =================================
     */

    if (!connectionExterna) await connection.commit();

    /*
     * =================================
     * RESPUESTA
     * =================================
     */

    return {
      empresa: {
        id: empresaId,
        nombre:
          empresa.nombre,
        cuit:
          empresa.cuit,
        email:
          empresa.email,
        telefono:
          empresa.telefono,
        plan:
          empresa.plan,
        activo: true,
      },

      administrador: {
        id: usuarioId,
        empresa_id:
          empresaId,
        nombre:
          administrador.nombre,
        apellido:
          administrador.apellido,
        usuario:
          administrador.usuario,
        email:
          administrador.email,
        rol_id:
          Number(
            rolAdministrador.id,
          ),
        rol:
          rolAdministrador.nombre,
        activo: true,
      },
    };
  } catch (error) {
    if (!connectionExterna) await connection.rollback();

    throw error;
  } finally {
    if (!connectionExterna) connection.release();
  }
};

module.exports = {
  crearEmpresa,
};
