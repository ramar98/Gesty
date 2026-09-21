const db = require(
  "../config/db",
);

/*
 * =====================================
 * OBTENER INGRESO POR ID
 * =====================================
 */

const obtenerIngresoPorId =
  async (
    id,
    empresaId,
  ) => {
    const [ingresos] =
      await db.query(
        `
          SELECT
            i.id,
            i.empresa_id,
            i.proveedor_id,
            i.numero_comprobante,
            i.fecha,
            i.total,
            i.observaciones,
            i.usuario_id,
            i.created_at,

            p.nombre AS proveedor,

            u.nombre AS usuario_nombre,
            u.apellido AS usuario_apellido

          FROM ingresos i

          INNER JOIN proveedores p
            ON p.id = i.proveedor_id
           AND p.empresa_id =
               i.empresa_id

          LEFT JOIN usuarios u
            ON u.id = i.usuario_id
           AND u.empresa_id =
               i.empresa_id

          WHERE
            i.id = ?
            AND i.empresa_id = ?

          LIMIT 1
        `,
        [
          id,
          empresaId,
        ],
      );

    if (
      ingresos.length ===
      0
    ) {
      return null;
    }

    const [detalles] =
      await db.query(
        `
          SELECT
            idet.id,
            idet.ingreso_id,
            idet.variante_id,
            idet.cantidad,
            idet.precio_costo,
            idet.subtotal,

            pv.codigo_barras,
            pv.producto_id,

            p.codigo AS producto_codigo,
            p.nombre AS producto_nombre,

            c.nombre AS color,
            t.nombre AS talle

          FROM ingresos_detalle idet

          INNER JOIN ingresos i
            ON i.id =
              idet.ingreso_id

          INNER JOIN producto_variantes pv
            ON pv.id =
              idet.variante_id

          INNER JOIN productos p
            ON p.id =
              pv.producto_id

          LEFT JOIN colores c
            ON c.id =
              pv.color_id
           AND c.empresa_id =
              p.empresa_id

          LEFT JOIN talles t
            ON t.id =
              pv.talle_id
           AND t.empresa_id =
              p.empresa_id

          WHERE
            idet.ingreso_id = ?
            AND idet.empresa_id = ?
            AND i.empresa_id = ?
            AND pv.empresa_id = ?
            AND p.empresa_id = ?

          ORDER BY
            p.nombre ASC,
            c.nombre ASC,
            t.nombre ASC
        `,
        [
          id,
          empresaId,
          empresaId,
          empresaId,
          empresaId,
        ],
      );

    const ingreso =
      ingresos[0];

    return {
      ...ingreso,

      total:
        Number(
          ingreso.total ??
          0,
        ),

      productos:
        detalles.map(
          (detalle) => ({
            ...detalle,

            cantidad:
              Number(
                detalle.cantidad ??
                0,
              ),

            precio_costo:
              Number(
                detalle.precio_costo ??
                0,
              ),

            subtotal:
              Number(
                detalle.subtotal ??
                0,
              ),
          }),
        ),
    };
  };

/*
 * =====================================
 * OBTENER INGRESOS
 * =====================================
 */

const obtenerIngresos =
  async ({
    empresaId,
    fechaDesde = null,
    fechaHasta = null,
    proveedorId = null,
  } = {}) => {
    const condiciones = [
      "i.empresa_id = ?",
    ];

    const parametros = [
      empresaId,
    ];

    if (fechaDesde) {
      condiciones.push(
        "i.fecha >= ?",
      );

      parametros.push(
        fechaDesde,
      );
    }

    if (fechaHasta) {
      condiciones.push(
        "i.fecha <= ?",
      );

      parametros.push(
        fechaHasta,
      );
    }

    if (proveedorId) {
      condiciones.push(
        "i.proveedor_id = ?",
      );

      parametros.push(
        proveedorId,
      );
    }

    const where = `
      WHERE ${condiciones.join(
      " AND ",
    )}
    `;

    const [rows] =
      await db.query(
        `
          SELECT
            i.id,
            i.empresa_id,
            i.proveedor_id,
            i.numero_comprobante,
            i.fecha,
            i.total,
            i.observaciones,
            i.usuario_id,
            i.created_at,

            p.nombre AS proveedor,

            u.nombre AS usuario_nombre,
            u.apellido AS usuario_apellido,

            COUNT(
              idet.id
            ) AS cantidad_items,

            COALESCE(
              SUM(
                idet.cantidad
              ),
              0
            ) AS cantidad_unidades

          FROM ingresos i

          INNER JOIN proveedores p
            ON p.id =
              i.proveedor_id
           AND p.empresa_id =
              i.empresa_id

          LEFT JOIN usuarios u
            ON u.id =
              i.usuario_id
           AND u.empresa_id =
              i.empresa_id

          LEFT JOIN ingresos_detalle idet
            ON idet.ingreso_id =
              i.id
           AND idet.empresa_id =
              i.empresa_id

          ${where}

          GROUP BY
            i.id,
            i.empresa_id,
            i.proveedor_id,
            i.numero_comprobante,
            i.fecha,
            i.total,
            i.observaciones,
            i.usuario_id,
            i.created_at,
            p.nombre,
            u.nombre,
            u.apellido

          ORDER BY
            i.fecha DESC,
            i.id DESC
        `,
        parametros,
      );

    return rows.map(
      (fila) => ({
        ...fila,

        total:
          Number(
            fila.total ??
            0,
          ),

        cantidad_items:
          Number(
            fila.cantidad_items ??
            0,
          ),

        cantidad_unidades:
          Number(
            fila.cantidad_unidades ??
            0,
          ),
      }),
    );
  };

/*
 * =====================================
 * CREAR INGRESO
 * =====================================
 */

const crearIngreso =
  async (
    data,
  ) => {
    const {
      empresa_id,
      proveedor_id,
      numero_comprobante = null,
      fecha,
      observaciones = null,
      usuario_id,
      productos,
    } = data;

    const empresaId =
      Number(
        empresa_id,
      );

    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      if (
        !Number.isInteger(
          empresaId,
        ) ||
        empresaId <= 0
      ) {
        const error =
          new Error(
            "No se pudo identificar la empresa.",
          );

        error.code =
          "EMPRESA_NO_ASIGNADA";

        throw error;
      }

      if (!usuario_id) {
        const error =
          new Error(
            "No se pudo identificar al usuario de la sesión.",
          );

        error.code =
          "USUARIO_NO_ENCONTRADO";

        throw error;
      }

      const [usuarios] =
        await connection.query(
          `
            SELECT
              id

            FROM usuarios

            WHERE
              id = ?
              AND empresa_id = ?
              AND activo = TRUE

            LIMIT 1
          `,
          [
            usuario_id,
            empresaId,
          ],
        );

      if (
        usuarios.length ===
        0
      ) {
        const error =
          new Error(
            "El usuario de la sesión no existe, está inactivo o no pertenece a la empresa.",
          );

        error.code =
          "USUARIO_NO_ENCONTRADO";

        throw error;
      }

      const [proveedores] =
        await connection.query(
          `
            SELECT
              id

            FROM proveedores

            WHERE
              id = ?
              AND empresa_id = ?

            LIMIT 1
          `,
          [
            proveedor_id,
            empresaId,
          ],
        );

      if (
        proveedores.length ===
        0
      ) {
        const error =
          new Error(
            "El proveedor seleccionado no existe o no pertenece a la empresa.",
          );

        error.code =
          "PROVEEDOR_NO_ENCONTRADO";

        throw error;
      }

      let totalIngreso =
        0;

      const productosProcesados =
        [];

      for (
        const item of productos
      ) {
        const varianteId =
          Number(
            item.variante_id,
          );

        const cantidad =
          Number(
            item.cantidad,
          );

        const precioCosto =
          Number(
            item.precio_costo,
          );

        const [variantes] =
          await connection.query(
            `
              SELECT
                pv.id,
                pv.producto_id,
                pv.stock_actual,

                p.nombre AS producto_nombre

              FROM producto_variantes pv

              INNER JOIN productos p
                ON p.id =
                  pv.producto_id

              WHERE
                pv.id = ?
                AND pv.empresa_id = ?
                AND p.empresa_id = ?
                AND p.activo = TRUE

              FOR UPDATE
            `,
            [
              varianteId,
              empresaId,
              empresaId,
            ],
          );

        if (
          variantes.length ===
          0
        ) {
          const error =
            new Error(
              `La variante ${varianteId} no existe o no pertenece a la empresa.`,
            );

          error.code =
            "VARIANTE_NO_ENCONTRADA";

          throw error;
        }

        const variante =
          variantes[0];

        const stockAnterior =
          Number(
            variante.stock_actual ??
            0,
          );

        const stockNuevo =
          stockAnterior +
          cantidad;

        const subtotal =
          cantidad *
          precioCosto;

        totalIngreso +=
          subtotal;

        productosProcesados.push(
          {
            varianteId,

            productoId:
              variante.producto_id,

            cantidad,

            precioCosto,

            subtotal,

            stockAnterior,

            stockNuevo,

            productoNombre:
              variante.producto_nombre,
          },
        );
      }

      const [ingresoResult] =
        await connection.query(
          `
            INSERT INTO ingresos
            (
              empresa_id,
              proveedor_id,
              numero_comprobante,
              fecha,
              total,
              observaciones,
              usuario_id
            )

            VALUES (
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
            empresaId,
            proveedor_id,
            numero_comprobante,
            fecha,
            totalIngreso,
            observaciones,
            usuario_id,
          ],
        );

      const ingresoId =
        ingresoResult.insertId;

      for (
        const item of productosProcesados
      ) {
        await connection.query(
          `
            INSERT INTO ingresos_detalle
            (
              empresa_id,
              ingreso_id,
              variante_id,
              cantidad,
              precio_costo,
              subtotal
            )

            VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              ?
            )
          `,
          [
            empresaId,
            ingresoId,
            item.varianteId,
            item.cantidad,
            item.precioCosto,
            item.subtotal,
          ],
        );

        const [stockResult] =
          await connection.query(
            `
              UPDATE producto_variantes pv

              SET
                pv.stock_actual = ?,
                pv.precio_costo = ?

              WHERE
                pv.id = ?
                AND pv.empresa_id = ?

                AND EXISTS (
                  SELECT 1

                  FROM productos p

                  WHERE
                    p.id =
                      pv.producto_id

                    AND p.empresa_id = ?

                    AND p.activo = TRUE
                )
            `,
            [
              item.stockNuevo,
              item.precioCosto,
              item.varianteId,
              empresaId,
              empresaId,
            ],
          );

        if (
          stockResult.affectedRows ===
          0
        ) {
          const error =
            new Error(
              `No se pudo actualizar la variante ${item.varianteId}.`,
            );

          error.code =
            "VARIANTE_NO_ENCONTRADA";

          throw error;
        }

        const referencia =
          `Ingreso #${ingresoId}`;

        const observacionMovimiento =
          numero_comprobante
            ? `Comprobante: ${numero_comprobante}`
            : observaciones;

        await connection.query(
          `
            INSERT INTO movimientos_stock
            (
              empresa_id,
              variante_id,
              tipo,
              cantidad,
              stock_anterior,
              stock_nuevo,
              referencia,
              usuario_id,
              observacion
            )

            VALUES (
              ?,
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
            empresaId,
            item.varianteId,
            "INGRESO",
            item.cantidad,
            item.stockAnterior,
            item.stockNuevo,
            referencia,
            usuario_id,
            observacionMovimiento,
          ],
        );
      }

      await connection.commit();

      return await obtenerIngresoPorId(
        ingresoId,
        empresaId,
      );
    } catch (error) {
      await connection.rollback();

      throw error;
    } finally {
      connection.release();
    }
  };

module.exports = {
  obtenerIngresos,
  obtenerIngresoPorId,
  crearIngreso,
};