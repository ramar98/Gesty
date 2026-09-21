const db = require("../config/db");

const obtenerVentaPorId = async (
  id,
  empresaId,
) => {
  const [ventas] = await db.query(
    `
      SELECT
        v.id,
        v.empresa_id,
        v.cliente_id,
        v.fecha,
        v.subtotal,
        v.descuento,
        v.total,
        v.metodo_pago,
        v.usuario_id,
        v.estado,
        v.anulada_at,
        v.anulada_por,
        v.motivo_anulacion,

        c.nombre AS cliente,
        c.telefono AS cliente_telefono,
        c.email AS cliente_email,

        u.nombre AS usuario_nombre,
        u.apellido AS usuario_apellido,

        ua.nombre AS anulada_por_nombre,
        ua.apellido AS anulada_por_apellido

      FROM ventas v

      LEFT JOIN clientes c
        ON c.id = v.cliente_id
       AND c.empresa_id = v.empresa_id

      LEFT JOIN usuarios u
        ON u.id = v.usuario_id
       AND u.empresa_id = v.empresa_id

      LEFT JOIN usuarios ua
        ON ua.id = v.anulada_por
       AND ua.empresa_id = v.empresa_id

      WHERE
        v.id = ?
        AND v.empresa_id = ?

      LIMIT 1
    `,
    [
      id,
      empresaId,
    ],
  );

  if (ventas.length === 0) {
    return null;
  }

  const [detalles] = await db.query(
    `
      SELECT
        vd.id,
        vd.venta_id,
        vd.variante_id,
        vd.cantidad,
        vd.precio_unitario,
        vd.subtotal,

        pv.producto_id,
        pv.codigo_barras,

        p.codigo AS producto_codigo,
        p.nombre AS producto_nombre,

        c.nombre AS color,
        t.nombre AS talle

      FROM ventas_detalle vd

      INNER JOIN ventas v
        ON v.id = vd.venta_id

      INNER JOIN producto_variantes pv
        ON pv.id = vd.variante_id

      INNER JOIN productos p
        ON p.id = pv.producto_id

      LEFT JOIN colores c
        ON c.id = pv.color_id
       AND c.empresa_id = p.empresa_id

      LEFT JOIN talles t
        ON t.id = pv.talle_id
       AND t.empresa_id = p.empresa_id

      WHERE
        vd.venta_id = ?
        AND vd.empresa_id = ?
        AND v.empresa_id = ?
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

  return {
    ...ventas[0],

    productos:
      detalles,
  };
};

const obtenerVentas = async ({
  empresaId,
  fechaDesde = null,
  fechaHasta = null,
  clienteId = null,
  metodoPago = null,
} = {}) => {
  const condiciones = [
    "v.empresa_id = ?",
  ];

  const parametros = [
    empresaId,
  ];

  if (fechaDesde) {
    condiciones.push(
      "DATE(v.fecha) >= ?",
    );

    parametros.push(
      fechaDesde,
    );
  }

  if (fechaHasta) {
    condiciones.push(
      "DATE(v.fecha) <= ?",
    );

    parametros.push(
      fechaHasta,
    );
  }

  if (clienteId) {
    condiciones.push(
      "v.cliente_id = ?",
    );

    parametros.push(
      clienteId,
    );
  }

  if (metodoPago) {
    condiciones.push(
      "v.metodo_pago = ?",
    );

    parametros.push(
      metodoPago,
    );
  }

  const where = `
    WHERE ${condiciones.join(" AND ")}
  `;

  const [rows] =
    await db.query(
      `
        SELECT
          v.id,
          v.empresa_id,
          v.cliente_id,
          v.fecha,
          v.subtotal,
          v.descuento,
          v.total,
          v.metodo_pago,
          v.usuario_id,
          v.estado,
          v.anulada_at,
          v.anulada_por,
          v.motivo_anulacion,

          c.nombre AS cliente,

          u.nombre AS usuario_nombre,
          u.apellido AS usuario_apellido,

          COUNT(vd.id) AS cantidad_items,

          COALESCE(
            SUM(vd.cantidad),
            0
          ) AS cantidad_unidades

        FROM ventas v

        LEFT JOIN clientes c
          ON c.id = v.cliente_id
         AND c.empresa_id = v.empresa_id

        LEFT JOIN usuarios u
          ON u.id = v.usuario_id
         AND u.empresa_id = v.empresa_id

        LEFT JOIN ventas_detalle vd
          ON vd.venta_id = v.id
         AND vd.empresa_id = v.empresa_id

        ${where}

        GROUP BY
          v.id,
          v.empresa_id,
          v.cliente_id,
          v.fecha,
          v.subtotal,
          v.descuento,
          v.total,
          v.metodo_pago,
          v.usuario_id,
          v.estado,
          v.anulada_at,
          v.anulada_por,
          v.motivo_anulacion,
          c.nombre,
          u.nombre,
          u.apellido

        ORDER BY
          v.fecha DESC,
          v.id DESC
      `,
      parametros,
    );

  return rows;
};

const crearVenta =
  async (
    data,
  ) => {
    const {
      empresa_id,
      cliente_id = null,
      descuento = 0,
      metodo_pago,
      usuario_id = null,
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

      if (cliente_id) {
        const [clientes] =
          await connection.query(
            `
              SELECT
                id

              FROM clientes

              WHERE
                id = ?
                AND empresa_id = ?

              LIMIT 1
            `,
            [
              cliente_id,
              empresaId,
            ],
          );

        if (
          clientes.length ===
          0
        ) {
          const error =
            new Error(
              "El cliente seleccionado no existe o no pertenece a la empresa.",
            );

          error.code =
            "CLIENTE_NO_ENCONTRADO";

          throw error;
        }
      }

      if (usuario_id) {
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
              "El usuario seleccionado no existe, está inactivo o no pertenece a la empresa.",
            );

          error.code =
            "USUARIO_NO_ENCONTRADO";

          throw error;
        }
      }

      let subtotalVenta = 0;

      const productosProcesados =
        [];

      for (
        const item
        of productos
      ) {
        const varianteId =
          Number(
            item.variante_id,
          );

        const cantidad =
          Number(
            item.cantidad,
          );

        const precioUnitario =
          Number(
            item.precio_unitario,
          );

        const [variantes] =
          await connection.query(
            `
              SELECT
                pv.id,
                pv.producto_id,
                pv.stock_actual,
                pv.precio_venta,

                p.nombre AS producto_nombre

              FROM producto_variantes pv

              INNER JOIN productos p
                ON p.id = pv.producto_id

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

        if (
          stockAnterior <
          cantidad
        ) {
          const error =
            new Error(
              `Stock insuficiente para la variante ${varianteId}. Disponible: ${stockAnterior}.`,
            );

          error.code =
            "STOCK_INSUFICIENTE";

          error.varianteId =
            varianteId;

          error.stockDisponible =
            stockAnterior;

          throw error;
        }

        const precioFinal =
          Number.isFinite(
            precioUnitario,
          ) &&
          precioUnitario >= 0
            ? precioUnitario
            : Number(
                variante.precio_venta ??
                0,
              );

        const subtotal =
          cantidad *
          precioFinal;

        const stockNuevo =
          stockAnterior -
          cantidad;

        subtotalVenta +=
          subtotal;

        productosProcesados.push({
          varianteId,

          productoId:
            variante.producto_id,

          cantidad,

          precioUnitario:
            precioFinal,

          subtotal,

          stockAnterior,

          stockNuevo,
        });
      }

      const descuentoNormalizado =
        Number(
          descuento ?? 0,
        );

      const totalVenta =
        Math.max(
          subtotalVenta -
            descuentoNormalizado,
          0,
        );

      const [ventaResult] =
        await connection.query(
          `
            INSERT INTO ventas
            (
              empresa_id,
              cliente_id,
              fecha,
              subtotal,
              descuento,
              total,
              metodo_pago,
              usuario_id
            )

            VALUES (
              ?,
              ?,
              CURRENT_TIMESTAMP,
              ?,
              ?,
              ?,
              ?,
              ?
            )
          `,
          [
            empresaId,
            cliente_id,
            subtotalVenta,
            descuentoNormalizado,
            totalVenta,
            metodo_pago,
            usuario_id,
          ],
        );

      const ventaId =
        ventaResult.insertId;

      for (
        const item
        of productosProcesados
      ) {
        await connection.query(
          `
            INSERT INTO ventas_detalle
            (
              empresa_id,
              venta_id,
              variante_id,
              cantidad,
              precio_unitario,
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
            ventaId,
            item.varianteId,
            item.cantidad,
            item.precioUnitario,
            item.subtotal,
          ],
        );

        const [stockResult] =
          await connection.query(
            `
              UPDATE producto_variantes pv

              SET
                pv.stock_actual = ?

              WHERE
                pv.id = ?
                AND pv.empresa_id = ?

                AND EXISTS (
                  SELECT 1

                  FROM productos p

                  WHERE
                    p.id = pv.producto_id
                    AND p.empresa_id = ?
                    AND p.activo = TRUE
                )
            `,
            [
              item.stockNuevo,
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
            "VENTA",
            item.cantidad,
            item.stockAnterior,
            item.stockNuevo,
            `Venta #${ventaId}`,
            usuario_id,
            `Método de pago: ${metodo_pago}`,
          ],
        );
      }

      await connection.commit();

      return await obtenerVentaPorId(
        ventaId,
        empresaId,
      );
    } catch (error) {
      await connection.rollback();

      throw error;
    } finally {
      connection.release();
    }
  };

const anularVenta = async ({
  id,
  empresaId,
  usuarioId,
  motivo,
}) => {
  const ventaId =
    Number(id);

  const empresaIdNormalizado =
    Number(
      empresaId,
    );

  const usuarioIdNormalizado =
    Number(
      usuarioId,
    );

  const motivoNormalizado =
    String(
      motivo ?? "",
    ).trim();

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    if (
      !Number.isInteger(
        empresaIdNormalizado,
      ) ||
      empresaIdNormalizado <=
        0
    ) {
      const error =
        new Error(
          "No se pudo identificar la empresa.",
        );

      error.code =
        "EMPRESA_NO_ASIGNADA";

      throw error;
    }

    if (
      !Number.isInteger(
        ventaId,
      ) ||
      ventaId <= 0
    ) {
      const error =
        new Error(
          "La venta no es válida.",
        );

      error.code =
        "VENTA_NO_ENCONTRADA";

      throw error;
    }

    if (
      !Number.isInteger(
        usuarioIdNormalizado,
      ) ||
      usuarioIdNormalizado <=
        0
    ) {
      const error =
        new Error(
          "No se pudo identificar al usuario.",
        );

      error.code =
        "USUARIO_NO_ENCONTRADO";

      throw error;
    }

    const [ventas] =
      await connection.query(
        `
          SELECT
            id,
            empresa_id,
            estado

          FROM ventas

          WHERE
            id = ?
            AND empresa_id = ?

          LIMIT 1

          FOR UPDATE
        `,
        [
          ventaId,
          empresaIdNormalizado,
        ],
      );

    if (
      ventas.length ===
      0
    ) {
      const error =
        new Error(
          "Venta no encontrada.",
        );

      error.code =
        "VENTA_NO_ENCONTRADA";

      throw error;
    }

    const estado =
      String(
        ventas[0].estado ??
          "ACTIVA",
      )
        .trim()
        .toUpperCase();

    if (
      estado ===
      "ANULADA"
    ) {
      const error =
        new Error(
          "La venta ya se encuentra anulada.",
        );

      error.code =
        "VENTA_YA_ANULADA";

      throw error;
    }

    if (
      estado !==
      "ACTIVA"
    ) {
      const error =
        new Error(
          `La venta no puede anularse porque su estado actual es ${estado}.`,
        );

      error.code =
        "VENTA_NO_ANULABLE";

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
          usuarioIdNormalizado,
          empresaIdNormalizado,
        ],
      );

    if (
      usuarios.length ===
      0
    ) {
      const error =
        new Error(
          "El usuario que intenta anular la venta no existe, está inactivo o no pertenece a la empresa.",
        );

      error.code =
        "USUARIO_NO_ENCONTRADO";

      throw error;
    }

    const [detalles] =
      await connection.query(
        `
          SELECT
            vd.id,
            vd.variante_id,
            vd.cantidad,

            pv.stock_actual,

            p.id AS producto_id

          FROM ventas_detalle vd

          INNER JOIN producto_variantes pv
            ON pv.id = vd.variante_id

          INNER JOIN productos p
            ON p.id = pv.producto_id

          WHERE
            vd.venta_id = ?
            AND vd.empresa_id = ?
            AND pv.empresa_id = ?
            AND p.empresa_id = ?

          ORDER BY
            vd.variante_id ASC

          FOR UPDATE
        `,
        [
          ventaId,
          empresaIdNormalizado,
          empresaIdNormalizado,
          empresaIdNormalizado,
        ],
      );

    if (
      detalles.length ===
      0
    ) {
      const error =
        new Error(
          "La venta no tiene productos para restituir al stock.",
        );

      error.code =
        "VENTA_SIN_DETALLE";

      throw error;
    }

    for (
      const detalle
      of detalles
    ) {
      const varianteId =
        Number(
          detalle.variante_id,
        );

      const cantidad =
        Number(
          detalle.cantidad,
        );

      const stockAnterior =
        Number(
          detalle.stock_actual ??
            0,
        );

      if (
        !Number.isFinite(
          cantidad,
        ) ||
        cantidad <= 0
      ) {
        const error =
          new Error(
            `La cantidad registrada en la variante ${varianteId} no es válida.`,
          );

        error.code =
          "CANTIDAD_VENTA_INVALIDA";

        throw error;
      }

      const stockNuevo =
        stockAnterior +
        cantidad;

      const [resultadoStock] =
        await connection.query(
          `
            UPDATE producto_variantes pv

            SET
              pv.stock_actual = ?

            WHERE
              pv.id = ?
              AND pv.empresa_id = ?

              AND EXISTS (
                SELECT 1

                FROM productos p

                WHERE
                  p.id = pv.producto_id
                  AND p.empresa_id = ?
              )
          `,
          [
            stockNuevo,
            varianteId,
            empresaIdNormalizado,
            empresaIdNormalizado,
          ],
        );

      if (
        resultadoStock.affectedRows ===
        0
      ) {
        const error =
          new Error(
            `No se pudo restituir el stock de la variante ${varianteId}.`,
          );

        error.code =
          "VARIANTE_NO_ENCONTRADA";

        throw error;
      }

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
          empresaIdNormalizado,
          varianteId,
          "ANULACION_VENTA",
          cantidad,
          stockAnterior,
          stockNuevo,
          `Anulación venta #${ventaId}`,
          usuarioIdNormalizado,
          motivoNormalizado,
        ],
      );
    }

    const [resultadoVenta] =
      await connection.query(
        `
          UPDATE ventas

          SET
            estado =
              'ANULADA',

            anulada_at =
              CURRENT_TIMESTAMP,

            anulada_por = ?,

            motivo_anulacion = ?

          WHERE
            id = ?
            AND empresa_id = ?
            AND estado =
              'ACTIVA'
        `,
        [
          usuarioIdNormalizado,
          motivoNormalizado,
          ventaId,
          empresaIdNormalizado,
        ],
      );

    if (
      resultadoVenta.affectedRows !==
      1
    ) {
      const error =
        new Error(
          "No se pudo marcar la venta como anulada.",
        );

      error.code =
        "VENTA_NO_ANULABLE";

      throw error;
    }

    await connection.commit();

    return await obtenerVentaPorId(
      ventaId,
      empresaIdNormalizado,
    );
  } catch (error) {
    await connection.rollback();

    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  obtenerVentas,
  obtenerVentaPorId,
  crearVenta,
  anularVenta,
};