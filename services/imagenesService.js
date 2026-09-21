const fs = require("fs");
const path = require("path");

const db = require(
  "../config/db",
);

function normalizarRuta(ruta) {
  return String(
    ruta ?? "",
  ).replaceAll("\\", "/");
}

function obtenerRutaFisica(
  rutaGuardada,
) {
  const rutaNormalizada =
    normalizarRuta(
      rutaGuardada,
    );

  return path.resolve(
    __dirname,
    "..",
    rutaNormalizada,
  );
}

/*
 * =====================================
 * OBTENER IMAGEN POR ID
 * =====================================
 */

const obtenerImagenPorId =
  async (
    id,
    empresaId,
  ) => {
    const [rows] =
      await db.query(
        `
          SELECT
            pi.id,
            pi.producto_id,
            pi.ruta,
            pi.principal,
            pi.created_at

          FROM producto_imagenes pi

          INNER JOIN productos p
            ON p.id =
              pi.producto_id

          WHERE
            pi.id = ?
            AND p.empresa_id = ?

          LIMIT 1
        `,
        [
          id,
          empresaId,
        ],
      );

    return (
      rows[0] ??
      null
    );
  };

/*
 * =====================================
 * OBTENER IMÁGENES DEL PRODUCTO
 * =====================================
 */

const obtenerImagenes =
  async (
    productoId,
    empresaId,
  ) => {
    /*
     * Primero comprobamos que el
     * producto pertenezca a la empresa.
     */

    const [productos] =
      await db.query(
        `
          SELECT
            id

          FROM productos

          WHERE
            id = ?
            AND empresa_id = ?
            AND activo = TRUE

          LIMIT 1
        `,
        [
          productoId,
          empresaId,
        ],
      );

    if (
      productos.length === 0
    ) {
      return [];
    }

    const [rows] =
      await db.query(
        `
          SELECT
            pi.id,
            pi.producto_id,
            pi.ruta,
            pi.principal,
            pi.created_at

          FROM producto_imagenes pi

          INNER JOIN productos p
            ON p.id =
              pi.producto_id

          WHERE
            pi.producto_id = ?
            AND p.empresa_id = ?

          ORDER BY
            pi.principal DESC,
            pi.id ASC
        `,
        [
          productoId,
          empresaId,
        ],
      );

    return rows;
  };

/*
 * =====================================
 * GUARDAR IMAGEN
 * =====================================
 */

const guardarImagen =
  async (
    {
      producto_id,
      ruta,
      principal = false,
    },
    empresaId,
  ) => {
    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      /*
       * VALIDAR PRODUCTO + EMPRESA
       */

      const [producto] =
        await connection.query(
          `
            SELECT
              id

            FROM productos

            WHERE
              id = ?
              AND empresa_id = ?
              AND activo = TRUE

            LIMIT 1
          `,
          [
            producto_id,
            empresaId,
          ],
        );

      if (
        producto.length === 0
      ) {
        const error =
          new Error(
            "El producto seleccionado no existe o no pertenece a la empresa.",
          );

        error.code =
          "PRODUCTO_NO_ENCONTRADO";

        throw error;
      }

      /*
       * CONTAR IMÁGENES EXISTENTES
       */

      const [imagenesExistentes] =
        await connection.query(
          `
            SELECT
              COUNT(*) AS cantidad

            FROM producto_imagenes pi

            INNER JOIN productos p
              ON p.id =
                pi.producto_id

            WHERE
              pi.producto_id = ?
              AND p.empresa_id = ?
          `,
          [
            producto_id,
            empresaId,
          ],
        );

      const esPrimeraImagen =
        Number(
          imagenesExistentes[0]
            .cantidad,
        ) === 0;

      const debeSerPrincipal =
        esPrimeraImagen ||
        Boolean(
          principal,
        );

      /*
       * SI SERÁ PRINCIPAL,
       * DESMARCAMOS LAS DEMÁS
       */

      if (
        debeSerPrincipal
      ) {
        await connection.query(
          `
            UPDATE producto_imagenes pi

            INNER JOIN productos p
              ON p.id =
                pi.producto_id

            SET
              pi.principal = FALSE

            WHERE
              pi.producto_id = ?
              AND p.empresa_id = ?
          `,
          [
            producto_id,
            empresaId,
          ],
        );
      }

      const rutaNormalizada =
        normalizarRuta(
          ruta,
        );

      /*
       * INSERT
       */

      const [result] =
        await connection.query(
          `
      INSERT INTO producto_imagenes
      (
        empresa_id,
        producto_id,
        ruta,
        principal
      )

      VALUES (
        ?,
        ?,
        ?,
        ?
      )
    `,
          [
            empresaId,
            producto_id,
            rutaNormalizada,
            debeSerPrincipal,
          ],
        );

      await connection.commit();

      return obtenerImagenPorId(
        result.insertId,
        empresaId,
      );
    } catch (error) {
      await connection.rollback();

      /*
       * IMPORTANTE:
       *
       * Si la BD rechazó la imagen
       * después de que multer ya creó
       * el archivo, intentamos eliminar
       * el archivo físico para no dejar
       * archivos huérfanos.
       */

      try {
        const rutaFisica =
          obtenerRutaFisica(
            ruta,
          );

        if (
          fs.existsSync(
            rutaFisica,
          )
        ) {
          fs.unlinkSync(
            rutaFisica,
          );
        }
      } catch (
      errorArchivo
      ) {
        console.error(
          "No se pudo eliminar el archivo de una carga fallida:",
          errorArchivo,
        );
      }

      throw error;
    } finally {
      connection.release();
    }
  };

/*
 * =====================================
 * MARCAR COMO PRINCIPAL
 * =====================================
 */

const marcarComoPrincipal =
  async (
    id,
    empresaId,
  ) => {
    const imagen =
      await obtenerImagenPorId(
        id,
        empresaId,
      );

    if (!imagen) {
      return null;
    }

    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      /*
       * Desmarcamos sólo imágenes
       * del mismo producto y empresa.
       */

      await connection.query(
        `
          UPDATE producto_imagenes pi

          INNER JOIN productos p
            ON p.id =
              pi.producto_id

          SET
            pi.principal = FALSE

          WHERE
            pi.producto_id = ?
            AND p.empresa_id = ?
        `,
        [
          imagen.producto_id,
          empresaId,
        ],
      );

      /*
       * Marcamos principal sólo si
       * sigue perteneciendo a empresa.
       */

      const [resultado] =
        await connection.query(
          `
            UPDATE producto_imagenes pi

            INNER JOIN productos p
              ON p.id =
                pi.producto_id

            SET
              pi.principal = TRUE

            WHERE
              pi.id = ?
              AND p.empresa_id = ?
          `,
          [
            id,
            empresaId,
          ],
        );

      if (
        resultado.affectedRows === 0
      ) {
        await connection.rollback();

        return null;
      }

      await connection.commit();

      return obtenerImagenPorId(
        id,
        empresaId,
      );
    } catch (error) {
      await connection.rollback();

      throw error;
    } finally {
      connection.release();
    }
  };

/*
 * =====================================
 * ELIMINAR IMAGEN
 * =====================================
 */

const eliminarImagen =
  async (
    id,
    empresaId,
  ) => {
    const imagen =
      await obtenerImagenPorId(
        id,
        empresaId,
      );

    if (!imagen) {
      return {
        eliminada:
          false,

        motivo:
          "NO_ENCONTRADA",
      };
    }

    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      /*
       * DELETE protegido por empresa.
       */

      const [resultado] =
        await connection.query(
          `
            DELETE pi

            FROM producto_imagenes pi

            INNER JOIN productos p
              ON p.id =
                pi.producto_id

            WHERE
              pi.id = ?
              AND p.empresa_id = ?
          `,
          [
            id,
            empresaId,
          ],
        );

      if (
        resultado.affectedRows === 0
      ) {
        await connection.rollback();

        return {
          eliminada:
            false,

          motivo:
            "NO_ENCONTRADA",
        };
      }

      /*
       * Si eliminamos la principal,
       * elegimos otra.
       */

      if (
        Boolean(
          imagen.principal,
        )
      ) {
        const [imagenesRestantes] =
          await connection.query(
            `
              SELECT
                pi.id

              FROM producto_imagenes pi

              INNER JOIN productos p
                ON p.id =
                  pi.producto_id

              WHERE
                pi.producto_id = ?
                AND p.empresa_id = ?

              ORDER BY
                pi.id ASC

              LIMIT 1
            `,
            [
              imagen.producto_id,
              empresaId,
            ],
          );

        if (
          imagenesRestantes.length >
          0
        ) {
          await connection.query(
            `
              UPDATE producto_imagenes pi

              INNER JOIN productos p
                ON p.id =
                  pi.producto_id

              SET
                pi.principal = TRUE

              WHERE
                pi.id = ?
                AND p.empresa_id = ?
            `,
            [
              imagenesRestantes[0]
                .id,

              empresaId,
            ],
          );
        }
      }

      await connection.commit();

      /*
       * ARCHIVO FÍSICO
       */

      const rutaFisica =
        obtenerRutaFisica(
          imagen.ruta,
        );

      try {
        if (
          fs.existsSync(
            rutaFisica,
          )
        ) {
          fs.unlinkSync(
            rutaFisica,
          );
        }
      } catch (
      errorArchivo
      ) {
        console.error(
          "No se pudo eliminar el archivo físico:",
          errorArchivo,
        );
      }

      return {
        eliminada:
          true,

        producto_id:
          imagen.producto_id,
      };
    } catch (error) {
      await connection.rollback();

      throw error;
    } finally {
      connection.release();
    }
  };

module.exports = {
  obtenerImagenPorId,
  obtenerImagenes,
  guardarImagen,
  marcarComoPrincipal,
  eliminarImagen,
};