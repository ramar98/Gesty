const db = require(
  "../config/db",
);

/*
 * =====================================
 * VALIDAR RELACIONES DE LA EMPRESA
 * =====================================
 */

async function validarRelacionesProducto(
  empresaId,
  {
    categoria_id,
    marca_id,
    proveedor_id,
  },
) {
  /*
   * CATEGORÍA
   */

  if (categoria_id) {
    const [rows] =
      await db.query(
        `
          SELECT id
          FROM categorias
          WHERE id = ?
            AND empresa_id = ?
          LIMIT 1
        `,
        [
          categoria_id,
          empresaId,
        ],
      );

    if (
      rows.length === 0
    ) {
      const error =
        new Error(
          "La categoría no pertenece a la empresa.",
        );

      error.code =
        "CATEGORIA_NO_VALIDA";

      throw error;
    }
  }

  /*
   * MARCA
   */

  if (marca_id) {
    const [rows] =
      await db.query(
        `
          SELECT id
          FROM marcas
          WHERE id = ?
            AND empresa_id = ?
          LIMIT 1
        `,
        [
          marca_id,
          empresaId,
        ],
      );

    if (
      rows.length === 0
    ) {
      const error =
        new Error(
          "La marca no pertenece a la empresa.",
        );

      error.code =
        "MARCA_NO_VALIDA";

      throw error;
    }
  }

  /*
   * PROVEEDOR
   */

  if (proveedor_id) {
    const [rows] =
      await db.query(
        `
          SELECT id
          FROM proveedores
          WHERE id = ?
            AND empresa_id = ?
            AND activo = TRUE
          LIMIT 1
        `,
        [
          proveedor_id,
          empresaId,
        ],
      );

    if (
      rows.length === 0
    ) {
      const error =
        new Error(
          "El proveedor no pertenece a la empresa.",
        );

      error.code =
        "PROVEEDOR_NO_VALIDO";

      throw error;
    }
  }
}

/*
 * =====================================
 * NORMALIZAR USA VARIANTES
 * =====================================
 *
 * Solamente trabajamos internamente con:
 *
 * 1 = con variantes
 * 0 = sin variantes
 *
 * Evitamos Boolean("0"), porque devuelve true.
 */

function normalizarUsaVariantes(
  valor,
) {
  if (
    valor === false ||
    valor === 0 ||
    valor === "0" ||
    valor === "false"
  ) {
    return 0;
  }

  return 1;
}

/*
 * =====================================
 * GENERAR PREFIJO DE CATEGORÍA
 * =====================================
 *
 * Ejemplos:
 *
 * PANTALONES -> PAN
 * REMERAS    -> REM
 * BUZOS      -> BUZ
 *
 * Quitamos tildes, espacios y caracteres
 * especiales antes de tomar las primeras
 * 3 letras.
 */

function generarPrefijoCategoria(
  nombreCategoria,
) {
  const prefijo =
    String(
      nombreCategoria ?? "",
    )
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toUpperCase()
      .replace(
        /[^A-Z]/g,
        "",
      )
      .slice(
        0,
        3,
      );

  if (
    prefijo.length < 3
  ) {
    const error =
      new Error(
        "La categoría debe tener al menos 3 letras válidas para generar el código del producto.",
      );

    error.code =
      "CATEGORIA_CODIGO_NO_VALIDO";

    throw error;
  }

  return prefijo;
}

/*
 * =====================================
 * GENERAR CÓDIGO DE PRODUCTO
 * =====================================
 *
 * El código se genera automáticamente:
 *
 * PANTALONES -> PAN-001
 * PANTALONES -> PAN-002
 * REMERAS    -> REM-001
 *
 * La secuencia se calcula por empresa
 * y por prefijo.
 *
 * También se consideran productos
 * inactivos para no reutilizar códigos
 * históricos.
 */

async function generarCodigoProducto(
  connection,
  empresaId,
  categoriaId,
) {
  if (!categoriaId) {
    const error =
      new Error(
        "La categoría es obligatoria para generar el código del producto.",
      );

    error.code =
      "CATEGORIA_OBLIGATORIA";

    throw error;
  }

  /*
   * Bloqueamos la categoría durante
   * la generación para evitar que dos
   * altas simultáneas de la misma
   * categoría calculen el mismo código.
   */

  const [categorias] =
    await connection.query(
      `
        SELECT
          id,
          nombre

        FROM categorias

        WHERE
          id = ?
          AND empresa_id = ?

        LIMIT 1

        FOR UPDATE
      `,
      [
        categoriaId,
        empresaId,
      ],
    );

  if (
    categorias.length === 0
  ) {
    const error =
      new Error(
        "La categoría no pertenece a la empresa.",
      );

    error.code =
      "CATEGORIA_NO_VALIDA";

    throw error;
  }

  const nombreCategoria =
    categorias[0].nombre;

  const prefijo =
    generarPrefijoCategoria(
      nombreCategoria,
    );

  /*
   * Buscamos TODOS los códigos que ya
   * usan este prefijo en la empresa.
   *
   * No filtramos por activo para no
   * reutilizar códigos eliminados.
   */

  const [productos] =
    await connection.query(
      `
        SELECT
          codigo

        FROM productos

        WHERE
          empresa_id = ?
          AND codigo LIKE ?
      `,
      [
        empresaId,
        `${prefijo}-%`,
      ],
    );

  const expresionCodigo =
    new RegExp(
      `^${prefijo}-(\\d{3})$`,
    );

  let ultimoNumero = 0;

  for (
    const producto
    of productos
  ) {
    const coincidencia =
      String(
        producto.codigo ?? "",
      ).match(
        expresionCodigo,
      );

    if (!coincidencia) {
      continue;
    }

    const numero =
      Number(
        coincidencia[1],
      );

    if (
      Number.isInteger(
        numero,
      ) &&
      numero > ultimoNumero
    ) {
      ultimoNumero =
        numero;
    }
  }

  if (
    ultimoNumero >= 999
  ) {
    const error =
      new Error(
        `Se alcanzó el límite de códigos para la categoría ${nombreCategoria}.`,
      );

    error.code =
      "LIMITE_CODIGOS_CATEGORIA";

    throw error;
  }

  const siguienteNumero =
    ultimoNumero + 1;

  return `${prefijo}-${String(
    siguienteNumero,
  ).padStart(
    3,
    "0",
  )}`;
}

/*
 * =====================================
 * OBTENER PRODUCTOS
 * =====================================
 */

const obtenerProductos =
  async (
    empresaId,
  ) => {
    const [rows] =
      await db.query(
        `
          SELECT
            p.id,
            p.empresa_id,
            p.codigo,
            p.nombre,
            p.descripcion,
            p.categoria_id,
            p.marca_id,
            p.proveedor_id,

            p.precio_costo_default,
            p.precio_venta_default,

            p.usa_variantes,

            c.nombre AS categoria,
            m.nombre AS marca,
            pr.nombre AS proveedor,

            COUNT(
              DISTINCT v.id
            ) AS variantes,

            COALESCE(
              SUM(
                v.stock_actual
              ),
              0
            ) AS stock,

            COALESCE(
              MIN(
                v.precio_costo
              ),
              0
            ) AS precio_costo,

            COALESCE(
              MAX(
                v.precio_venta
              ),
              0
            ) AS precio_venta,

            (
              SELECT
                pi.ruta

              FROM producto_imagenes pi

              WHERE
                pi.producto_id =
                  p.id

              ORDER BY
                pi.principal DESC,
                pi.id ASC

              LIMIT 1
            ) AS imagen

          FROM productos p

          LEFT JOIN categorias c
            ON c.id =
              p.categoria_id
           AND c.empresa_id =
              p.empresa_id

          LEFT JOIN marcas m
            ON m.id =
              p.marca_id
           AND m.empresa_id =
              p.empresa_id

          LEFT JOIN proveedores pr
            ON pr.id =
              p.proveedor_id
           AND pr.empresa_id =
              p.empresa_id

          LEFT JOIN producto_variantes v
            ON v.producto_id =
              p.id

          WHERE
            p.empresa_id = ?
            AND p.activo = TRUE

          GROUP BY
            p.id,
            p.empresa_id,
            p.codigo,
            p.nombre,
            p.descripcion,
            p.categoria_id,
            p.marca_id,
            p.proveedor_id,
            p.precio_costo_default,
            p.precio_venta_default,
            p.usa_variantes,
            c.nombre,
            m.nombre,
            pr.nombre

          ORDER BY
            p.nombre ASC
        `,
        [
          empresaId,
        ],
      );

    return rows;
  };

/*
 * =====================================
 * OBTENER PRODUCTO POR ID
 * =====================================
 */

const obtenerProductoPorId =
  async (
    id,
    empresaId,
  ) => {
    const [productos] =
      await db.query(
        `
          SELECT
            p.id,
            p.empresa_id,
            p.codigo,
            p.nombre,
            p.descripcion,
            p.categoria_id,
            p.marca_id,
            p.proveedor_id,

            p.precio_costo_default,
            p.precio_venta_default,

            p.usa_variantes,

            p.activo,
            p.created_at,
            p.updated_at,

            c.nombre AS categoria,
            m.nombre AS marca,
            pr.nombre AS proveedor

          FROM productos p

          LEFT JOIN categorias c
            ON c.id =
              p.categoria_id
           AND c.empresa_id =
              p.empresa_id

          LEFT JOIN marcas m
            ON m.id =
              p.marca_id
           AND m.empresa_id =
              p.empresa_id

          LEFT JOIN proveedores pr
            ON pr.id =
              p.proveedor_id
           AND pr.empresa_id =
              p.empresa_id

          WHERE
            p.id = ?
            AND p.empresa_id = ?
            AND p.activo = TRUE

          LIMIT 1
        `,
        [
          id,
          empresaId,
        ],
      );

    if (
      productos.length ===
      0
    ) {
      return null;
    }

    const producto =
      productos[0];

    /*
     * =================================
     * VARIANTES
     * =================================
     */

    const [variantes] =
      await db.query(
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

            c.nombre AS color,
            t.nombre AS talle

          FROM producto_variantes v

          INNER JOIN productos p
            ON p.id =
              v.producto_id

          LEFT JOIN colores c
            ON c.id =
              v.color_id
           AND c.empresa_id =
              p.empresa_id

          LEFT JOIN talles t
            ON t.id =
              v.talle_id
           AND t.empresa_id =
              p.empresa_id

          WHERE
            v.producto_id = ?
            AND p.empresa_id = ?
            AND p.activo = TRUE

          ORDER BY
            c.nombre,
            t.nombre
        `,
        [
          id,
          empresaId,
        ],
      );

    /*
     * =================================
     * IMÁGENES
     * =================================
     */

    const [imagenes] =
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
            AND p.activo = TRUE

          ORDER BY
            pi.principal DESC,
            pi.id ASC
        `,
        [
          id,
          empresaId,
        ],
      );

    return {
      ...producto,

      variantes,

      imagenes,
    };
  };

/*
 * =====================================
 * CREAR VARIANTE INTERNA
 * =====================================
 *
 * Producto sin variantes:
 *
 * Se crea una variante interna para
 * mantener funcionando:
 *
 * - stock
 * - ventas
 * - ingresos
 * - movimientos
 *
 * El usuario no necesita seleccionar
 * color ni talle.
 *
 * Durante la creación del producto
 * podemos asignar stock inicial.
 */

async function crearVarianteInterna(
  connection,
  empresaId,
  productoId,
  precioCosto,
  precioVenta,
  stockInicial = 0,
) {
  const stock =
    Number(
      stockInicial ?? 0,
    );

  if (
    !Number.isFinite(stock) ||
    stock < 0
  ) {
    const error =
      new Error(
        "El stock inicial debe ser un número mayor o igual a cero.",
      );

    error.code =
      "STOCK_INICIAL_NO_VALIDO";

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
          NULL,
          NULL,
          NULL,
          ?,
          ?,
          ?,
          1
        )
      `,
      [
        empresaId,
        productoId,
        precioCosto,
        precioVenta,
        stock,
      ],
    );

  return result.insertId;
}

/*
 * =====================================
 * OBTENER VARIANTES INTERNAMENTE
 * =====================================
 */

async function obtenerVariantesProducto(
  connection,
  productoId,
) {
  const [rows] =
    await connection.query(
      `
        SELECT
          id,
          producto_id,
          color_id,
          talle_id,
          codigo_barras,
          precio_costo,
          precio_venta,
          stock_actual,
          stock_minimo

        FROM producto_variantes

        WHERE
          producto_id = ?

        ORDER BY
          id ASC
      `,
      [
        productoId,
      ],
    );

  return rows;
}

/*
 * =====================================
 * CREAR PRODUCTO
 * =====================================
 */

const crearProducto =
  async (
    empresaId,
    data,
  ) => {
    const {
      nombre,
      descripcion = null,
      categoria_id = null,
      marca_id = null,
      proveedor_id = null,

      precio_costo_default,
      precio_venta_default,

      usa_variantes = 1,

      /*
       * Solo se utilizará cuando
       * usa_variantes = false.
       */
      stock_inicial = 0,
    } = data;

    /*
     * =================================
     * NORMALIZAR TIPO
     * =================================
     */

    const usaVariantesDb =
      normalizarUsaVariantes(
        usa_variantes,
      );

    /*
     * =================================
     * NORMALIZAR STOCK INICIAL
     * =================================
     */

    let stockInicialDb = 0;

    if (
      usaVariantesDb === 0
    ) {
      stockInicialDb =
        Number(
          stock_inicial ?? 0,
        );

      if (
        !Number.isFinite(
          stockInicialDb,
        ) ||
        stockInicialDb < 0
      ) {
        const error =
          new Error(
            "El stock inicial debe ser un número mayor o igual a cero.",
          );

        error.code =
          "STOCK_INICIAL_NO_VALIDO";

        throw error;
      }
    }

    /*
     * =================================
     * CATEGORÍA OBLIGATORIA
     * =================================
     */

    if (!categoria_id) {
      const error =
        new Error(
          "La categoría es obligatoria para crear un producto.",
        );

      error.code =
        "CATEGORIA_OBLIGATORIA";

      throw error;
    }

    /*
     * Evita relaciones con registros
     * pertenecientes a otra empresa.
     */

    await validarRelacionesProducto(
      empresaId,
      {
        categoria_id,
        marca_id,
        proveedor_id,
      },
    );

    /*
     * =================================
     * TRANSACCIÓN
     * =================================
     */

    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      /*
       * =================================
       * GENERAR CÓDIGO AUTOMÁTICO
       * =================================
       */

      const codigo =
        await generarCodigoProducto(
          connection,
          empresaId,
          categoria_id,
        );

      /*
       * =================================
       * INSERT PRODUCTO
       * =================================
       */

      const [result] =
        await connection.query(
          `
            INSERT INTO productos
            (
              empresa_id,
              codigo,
              nombre,
              descripcion,
              categoria_id,
              marca_id,
              proveedor_id,

              precio_costo_default,
              precio_venta_default,

              usa_variantes
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
              ?,
              ?
            )
          `,
          [
            empresaId,
            codigo,
            nombre,
            descripcion,
            categoria_id,
            marca_id,
            proveedor_id,

            precio_costo_default,
            precio_venta_default,

            usaVariantesDb,
          ],
        );

      const productoId =
        result.insertId;

      /*
       * =================================
       * PRODUCTO SIN VARIANTES
       * =================================
       *
       * Creamos UNA variante interna
       * y asignamos el stock inicial.
       */

      if (
        usaVariantesDb === 0
      ) {
        await crearVarianteInterna(
          connection,
          empresaId,
          productoId,
          precio_costo_default,
          precio_venta_default,
          stockInicialDb,
        );
      }

      /*
       * =================================
       * COMMIT
       * =================================
       */

      await connection.commit();

      return obtenerProductoPorId(
        productoId,
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
 * ACTUALIZAR PRODUCTO
 * =====================================
 */

const actualizarProducto =
  async (
    id,
    empresaId,
    data,
  ) => {
    const {
      codigo,
      nombre,
      descripcion = null,
      categoria_id = null,
      marca_id = null,
      proveedor_id = null,

      precio_costo_default,
      precio_venta_default,

      usa_variantes = 1,
    } = data;

    /*
     * =================================
     * NORMALIZAR TIPO
     * =================================
     */

    const usaVariantesDb =
      normalizarUsaVariantes(
        usa_variantes,
      );

    /*
     * Validar relaciones
     */

    await validarRelacionesProducto(
      empresaId,
      {
        categoria_id,
        marca_id,
        proveedor_id,
      },
    );

    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      /*
       * =================================
       * PRODUCTO ACTUAL
       * =================================
       */

      const [productosActuales] =
        await connection.query(
          `
            SELECT
              id,
              usa_variantes

            FROM productos

            WHERE
              id = ?
              AND empresa_id = ?
              AND activo = TRUE

            LIMIT 1

            FOR UPDATE
          `,
          [
            id,
            empresaId,
          ],
        );

      if (
        productosActuales.length ===
        0
      ) {
        await connection.rollback();

        return null;
      }

      const productoActual =
        productosActuales[0];

      const usabaVariantes =
        Number(
          productoActual
            .usa_variantes,
        ) === 1;

      /*
       * =================================
       * VARIANTES EXISTENTES
       * =================================
       */

      const variantesExistentes =
        await obtenerVariantesProducto(
          connection,
          id,
        );

      /*
       * =================================
       * CON VARIANTES -> SIN VARIANTES
       * =================================
       *
       * Solamente permitimos convertir
       * cuando todavía no existen
       * variantes.
       */

      if (
        usabaVariantes &&
        usaVariantesDb === 0 &&
        variantesExistentes.length >
        0
      ) {
        const error =
          new Error(
            "No se puede convertir a producto sin variantes porque ya tiene variantes creadas.",
          );

        error.code =
          "PRODUCTO_TIENE_VARIANTES";

        throw error;
      }

      /*
       * =================================
       * SIN VARIANTES -> CON VARIANTES
       * =================================
       *
       * Un producto simple ya posee una
       * variante interna.
       *
       * No la eliminamos porque puede
       * tener stock o movimientos.
       */

      if (
        !usabaVariantes &&
        usaVariantesDb === 1 &&
        variantesExistentes.length >
        0
      ) {
        const error =
          new Error(
            "No se puede cambiar un producto simple a producto con variantes porque ya posee stock o una variante interna.",
          );

        error.code =
          "PRODUCTO_TIPO_NO_MODIFICABLE";

        throw error;
      }

      /*
       * =================================
       * UPDATE PRODUCTO
       * =================================
       */

      const [result] =
        await connection.query(
          `
            UPDATE productos

            SET
              codigo = ?,
              nombre = ?,
              descripcion = ?,
              categoria_id = ?,
              marca_id = ?,
              proveedor_id = ?,

              precio_costo_default = ?,
              precio_venta_default = ?,

              usa_variantes = ?

            WHERE
              id = ?
              AND empresa_id = ?
              AND activo = TRUE
          `,
          [
            codigo,
            nombre,
            descripcion,
            categoria_id,
            marca_id,
            proveedor_id,

            precio_costo_default,
            precio_venta_default,

            usaVariantesDb,

            id,
            empresaId,
          ],
        );

      if (
        result.affectedRows ===
        0
      ) {
        await connection.rollback();

        return null;
      }

      /*
       * =================================
       * PRODUCTO SIMPLE
       * =================================
       */

      if (
        usaVariantesDb === 0
      ) {
        /*
         * Si estamos convirtiendo un
         * producto viejo que no tenía
         * variantes, creamos la interna.
         */

        if (
          variantesExistentes.length ===
          0
        ) {
          await crearVarianteInterna(
            connection,
            empresaId,
            id,
            precio_costo_default,
            precio_venta_default,
          );
        } else {
          /*
           * Si YA era producto simple,
           * actualizamos el precio de
           * su variante interna.
           */

          const varianteInterna =
            variantesExistentes[0];

          await connection.query(
            `
              UPDATE producto_variantes

              SET
                precio_costo = ?,
                precio_venta = ?

              WHERE
                id = ?
                AND producto_id = ?
            `,
            [
              precio_costo_default,
              precio_venta_default,

              varianteInterna.id,
              id,
            ],
          );
        }
      }

      /*
       * =================================
       * COMMIT
       * =================================
       */

      await connection.commit();

      return obtenerProductoPorId(
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
 * ELIMINAR PRODUCTO
 * =====================================
 */

const eliminarProducto =
  async (
    id,
    empresaId,
  ) => {
    const [result] =
      await db.query(
        `
          UPDATE productos

          SET
            activo = FALSE

          WHERE
            id = ?
            AND empresa_id = ?
            AND activo = TRUE
        `,
        [
          id,
          empresaId,
        ],
      );

    return (
      result.affectedRows >
      0
    );
  };

/*
 * =====================================
 * EXPORTS
 * =====================================
 */

module.exports = {
  obtenerProductos,

  obtenerProductoPorId,

  crearProducto,

  actualizarProducto,

  eliminarProducto,
};