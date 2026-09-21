const db = require("../config/db");

/*
 * =====================================
 * OBTENER VARIANTES DE UN PRODUCTO
 * =====================================
 */

const obtenerVariantes = async (
  productoId,
  empresaId,
) => {
  const [rows] = await db.query(
    `
      SELECT
        v.id,
        v.producto_id,
        v.color_id,
        v.talle_id,
        v.codigo_barras,
        v.precio_costo,
        v.precio_venta,
        v.stock_actual,
        v.stock_minimo,
        v.created_at,

        c.nombre AS color,
        t.nombre AS talle

      FROM producto_variantes v

      INNER JOIN productos p
        ON p.id = v.producto_id

      LEFT JOIN colores c
        ON c.id = v.color_id
       AND c.empresa_id = p.empresa_id

      LEFT JOIN talles t
        ON t.id = v.talle_id
       AND t.empresa_id = p.empresa_id

      WHERE
        v.producto_id = ?
        AND p.empresa_id = ?

      ORDER BY
        c.nombre ASC,
        t.nombre ASC
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
 * OBTENER VARIANTE POR ID
 * =====================================
 */

const obtenerVariantePorId = async (
  id,
  empresaId,
) => {
  const [rows] = await db.query(
    `
      SELECT
        v.id,
        v.producto_id,
        v.color_id,
        v.talle_id,
        v.codigo_barras,
        v.precio_costo,
        v.precio_venta,
        v.stock_actual,
        v.stock_minimo,
        v.created_at,

        c.nombre AS color,
        t.nombre AS talle

      FROM producto_variantes v

      INNER JOIN productos p
        ON p.id = v.producto_id

      LEFT JOIN colores c
        ON c.id = v.color_id
       AND c.empresa_id = p.empresa_id

      LEFT JOIN talles t
        ON t.id = v.talle_id
       AND t.empresa_id = p.empresa_id

      WHERE
        v.id = ?
        AND p.empresa_id = ?

      LIMIT 1
    `,
    [
      id,
      empresaId,
    ],
  );

  return rows[0] ?? null;
};

/*
 * =====================================
 * VALIDAR PRODUCTO
 * =====================================
 */

const validarProductoEmpresa = async (
  productoId,
  empresaId,
  connection = db,
) => {
  const [rows] = await connection.query(
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

  return rows.length > 0;
};

/*
 * =====================================
 * VALIDAR COLOR
 * =====================================
 */

const validarColorEmpresa = async (
  colorId,
  empresaId,
  connection = db,
) => {
  const [rows] = await connection.query(
    `
      SELECT
        id

      FROM colores

      WHERE
        id = ?
        AND empresa_id = ?

      LIMIT 1
    `,
    [
      colorId,
      empresaId,
    ],
  );

  return rows.length > 0;
};

/*
 * =====================================
 * VALIDAR TALLE
 * =====================================
 */

const validarTalleEmpresa = async (
  talleId,
  empresaId,
  connection = db,
) => {
  const [rows] = await connection.query(
    `
      SELECT
        id

      FROM talles

      WHERE
        id = ?
        AND empresa_id = ?

      LIMIT 1
    `,
    [
      talleId,
      empresaId,
    ],
  );

  return rows.length > 0;
};

/*
 * =====================================
 * VALIDAR RELACIONES
 * =====================================
 */

const validarRelaciones = async ({
  productoId,
  colorId,
  talleId,
  empresaId,
  connection = db,
}) => {
  const productoValido =
    await validarProductoEmpresa(
      productoId,
      empresaId,
      connection,
    );

  if (!productoValido) {
    const error = new Error(
      "El producto seleccionado no existe o no pertenece a la empresa.",
    );

    error.code =
      "PRODUCTO_NO_ENCONTRADO";

    throw error;
  }

  const colorValido =
    await validarColorEmpresa(
      colorId,
      empresaId,
      connection,
    );

  if (!colorValido) {
    const error = new Error(
      "El color seleccionado no existe o no pertenece a la empresa.",
    );

    error.code =
      "COLOR_NO_ENCONTRADO";

    throw error;
  }

  const talleValido =
    await validarTalleEmpresa(
      talleId,
      empresaId,
      connection,
    );

  if (!talleValido) {
    const error = new Error(
      "El talle seleccionado no existe o no pertenece a la empresa.",
    );

    error.code =
      "TALLE_NO_ENCONTRADO";

    throw error;
  }
};

/*
 * =====================================
 * COMBINACIÓN COLOR + TALLE
 * =====================================
 */

const existeCombinacion = async ({
  productoId,
  colorId,
  talleId,
  empresaId,
  excluirVarianteId = null,
  connection = db,
}) => {
  const parametros = [
    productoId,
    colorId,
    talleId,
    empresaId,
  ];

  let condicionExcluir = "";

  if (excluirVarianteId) {
    condicionExcluir =
      "AND v.id <> ?";

    parametros.push(
      excluirVarianteId,
    );
  }

  const [rows] =
    await connection.query(
      `
        SELECT
          v.id

        FROM producto_variantes v

        INNER JOIN productos p
          ON p.id =
            v.producto_id

        WHERE
          v.producto_id = ?
          AND v.color_id = ?
          AND v.talle_id = ?
          AND p.empresa_id = ?

          ${condicionExcluir}

        LIMIT 1
      `,
      parametros,
    );

  return rows.length > 0;
};

/*
 * =====================================
 * CREAR VARIANTE
 * =====================================
 */

const crearVariante = async (
  data,
  empresaId,
) => {
  const {
    producto_id,
    color_id,
    talle_id,
    codigo_barras = null,
    precio_costo,
    precio_venta,
    stock_actual = 0,
    stock_minimo = 1,
  } = data;

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    /*
     * Producto, color y talle
     * deben pertenecer a la empresa.
     */

    await validarRelaciones({
      productoId:
        producto_id,

      colorId:
        color_id,

      talleId:
        talle_id,

      empresaId,

      connection,
    });

    /*
     * Evitamos combinación duplicada.
     */

    const combinacionExiste =
      await existeCombinacion({
        productoId:
          producto_id,

        colorId:
          color_id,

        talleId:
          talle_id,

        empresaId,

        connection,
      });

    if (combinacionExiste) {
      const error = new Error(
        "Ya existe una variante con ese color y talle.",
      );

      error.code =
        "VARIANTE_DUPLICADA";

      throw error;
    }

    const [result] =
      await connection.query(
        `
      INSERT INTO producto_variantes
      (
        empresa_id,
        producto_id,
        color_id,
        talle_id,
        codigo_barras,
        precio_costo,
        precio_venta,
        stock_actual,
        stock_minimo
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
          producto_id,
          color_id,
          talle_id,
          codigo_barras,
          precio_costo,
          precio_venta,
          stock_actual,
          stock_minimo,
        ],
      );

    const varianteId =
      result.insertId;

    /*
     * STOCK INICIAL
     */

    if (
      Number(stock_actual) > 0
    ) {
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
        ?
      )
    `,
        [
          empresaId,
          varianteId,
          "AJUSTE",
          Number(
            stock_actual,
          ),
          0,
          Number(
            stock_actual,
          ),
          `Stock inicial variante #${varianteId}`,
          "Stock inicial registrado al crear la variante.",
        ],
      );
    }

    await connection.commit();

    return obtenerVariantePorId(
      varianteId,
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
 * ACTUALIZAR VARIANTE
 * =====================================
 */

const actualizarVariante = async (
  id,
  data,
  empresaId,
) => {
  const {
    color_id,
    talle_id,
    codigo_barras = null,
    precio_costo,
    precio_venta,
    stock_minimo = 1,
  } = data;

  /*
   * Primero comprobamos que la
   * variante pertenezca a la empresa.
   */

  const varianteActual =
    await obtenerVariantePorId(
      id,
      empresaId,
    );

  if (!varianteActual) {
    return null;
  }

  /*
   * El nuevo color/talle también debe
   * pertenecer a la empresa.
   */

  await validarRelaciones({
    productoId:
      varianteActual.producto_id,

    colorId:
      color_id,

    talleId:
      talle_id,

    empresaId,
  });

  const combinacionExiste =
    await existeCombinacion({
      productoId:
        varianteActual.producto_id,

      colorId:
        color_id,

      talleId:
        talle_id,

      empresaId,

      excluirVarianteId:
        id,
    });

  if (combinacionExiste) {
    const error = new Error(
      "Ya existe otra variante con ese color y talle.",
    );

    error.code =
      "VARIANTE_DUPLICADA";

    throw error;
  }

  /*
   * UPDATE protegido mediante
   * JOIN con productos.
   */

  const [result] =
    await db.query(
      `
        UPDATE producto_variantes v

        INNER JOIN productos p
          ON p.id =
            v.producto_id

        SET
          v.color_id = ?,
          v.talle_id = ?,
          v.codigo_barras = ?,
          v.precio_costo = ?,
          v.precio_venta = ?,
          v.stock_minimo = ?

        WHERE
          v.id = ?
          AND p.empresa_id = ?
      `,
      [
        color_id,
        talle_id,
        codigo_barras,
        precio_costo,
        precio_venta,
        stock_minimo,
        id,
        empresaId,
      ],
    );

  if (
    result.affectedRows === 0
  ) {
    return null;
  }

  return obtenerVariantePorId(
    id,
    empresaId,
  );
};

/*
 * =====================================
 * MOVIMIENTOS RELACIONADOS
 * =====================================
 */

const tieneMovimientosRelacionados =
  async (
    varianteId,
    empresaId,
  ) => {
    /*
     * Primero verificamos que la
     * variante realmente sea de
     * la empresa.
     */

    const variante =
      await obtenerVariantePorId(
        varianteId,
        empresaId,
      );

    if (!variante) {
      return false;
    }

    const [rows] =
      await db.query(
        `
          SELECT
            (
              SELECT COUNT(*)

              FROM movimientos_stock ms

              WHERE
                ms.variante_id = ?
            ) AS movimientos,

            (
              SELECT COUNT(*)

              FROM ingresos_detalle idet

              WHERE
                idet.variante_id = ?
            ) AS ingresos,

            (
              SELECT COUNT(*)

              FROM ventas_detalle vd

              WHERE
                vd.variante_id = ?
            ) AS ventas
        `,
        [
          varianteId,
          varianteId,
          varianteId,
        ],
      );

    const resultado =
      rows[0];

    return (
      Number(
        resultado.movimientos,
      ) > 0 ||

      Number(
        resultado.ingresos,
      ) > 0 ||

      Number(
        resultado.ventas,
      ) > 0
    );
  };

/*
 * =====================================
 * ELIMINAR VARIANTE
 * =====================================
 */

const eliminarVariante = async (
  id,
  empresaId,
) => {
  const variante =
    await obtenerVariantePorId(
      id,
      empresaId,
    );

  if (!variante) {
    return {
      eliminada: false,
      motivo:
        "NO_ENCONTRADA",
    };
  }

  const tieneRelaciones =
    await tieneMovimientosRelacionados(
      id,
      empresaId,
    );

  if (tieneRelaciones) {
    return {
      eliminada: false,
      motivo:
        "TIENE_MOVIMIENTOS",
    };
  }

  /*
   * DELETE también protegido
   * por la empresa del producto.
   */

  const [result] =
    await db.query(
      `
        DELETE v

        FROM producto_variantes v

        INNER JOIN productos p
          ON p.id =
            v.producto_id

        WHERE
          v.id = ?
          AND p.empresa_id = ?
      `,
      [
        id,
        empresaId,
      ],
    );

  return {
    eliminada:
      result.affectedRows > 0,

    motivo:
      result.affectedRows > 0
        ? null
        : "NO_ENCONTRADA",
  };
};

module.exports = {
  obtenerVariantes,
  obtenerVariantePorId,
  crearVariante,
  actualizarVariante,
  eliminarVariante,
};