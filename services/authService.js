const bcrypt = require(
  "bcryptjs",
);

const jwt = require(
  "jsonwebtoken",
);

const db = require(
  "../config/db",
);

/*
 * =====================================
 * JWT SECRET
 * =====================================
 */

function obtenerJwtSecret() {
  const secret =
    process.env.JWT_SECRET;

  if (!secret) {
    const error =
      new Error(
        "JWT_SECRET no está configurado.",
      );

    error.code =
      "JWT_SECRET_NO_CONFIGURADO";

    throw error;
  }

  return secret;
}

/*
 * =====================================
 * LIMPIAR USUARIO
 * =====================================
 */

function limpiarUsuario(
  usuario,
) {
  if (!usuario) {
    return null;
  }

  return {
    id:
      Number(
        usuario.id,
      ),

    empresa_id:
      Number(
        usuario.empresa_id,
      ),

    empresa:
      usuario.empresa ??
      "",

    nombre:
      usuario.nombre ??
      "",

    apellido:
      usuario.apellido ??
      "",

    usuario:
      usuario.usuario ??
      "",

    email:
      usuario.email ??
      "",

    rol_id:
      Number(
        usuario.rol_id,
      ),

    rol:
      usuario.rol ??
      "",

    activo:
      Boolean(
        usuario.activo,
      ),
  };
}

/*
 * =====================================
 * GENERAR TOKEN
 * =====================================
 */

function generarToken(
  usuario,
) {
  return jwt.sign(
    {
      userId:
        usuario.id,

      /*
       * NUEVO
       */
      empresaId:
        usuario.empresa_id,

      rolId:
        usuario.rol_id,

      rol:
        usuario.rol,
    },

    obtenerJwtSecret(),

    {
      expiresIn:
        process.env
          .JWT_EXPIRES_IN ||
        "8h",
    },
  );
}

/*
 * =====================================
 * BUSCAR CANDIDATOS LOGIN
 * =====================================
 *
 * Ahora usuario/email pueden repetirse
 * entre empresas.
 *
 * Por eso no hacemos LIMIT 1 antes de
 * verificar la contraseña.
 * =====================================
 */

const obtenerUsuariosPorIdentificador =
  async (
    identificador,
  ) => {
    const [rows] =
      await db.query(
        `
          SELECT
            u.id,
            u.empresa_id,
            u.nombre,
            u.apellido,
            u.usuario,
            u.email,
            u.password,
            u.rol_id,

            r.nombre AS rol,

            u.activo,

            e.nombre AS empresa,
            e.activo AS empresa_activa,

            u.created_at,
            u.updated_at

          FROM usuarios u

          INNER JOIN roles r
            ON r.id = u.rol_id

          INNER JOIN empresas e
            ON e.id = u.empresa_id

          WHERE
            LOWER(u.email) = LOWER(?)
            OR
            LOWER(u.usuario) = LOWER(?)

          ORDER BY u.id ASC
        `,
        [
          identificador,
          identificador,
        ],
      );

    return rows;
  };

/*
 * =====================================
 * USUARIO POR ID
 * =====================================
 */

const obtenerUsuarioPorId =
  async (
    id,
  ) => {
    const [rows] =
      await db.query(
        `
          SELECT
            u.id,
            u.empresa_id,

            u.nombre,
            u.apellido,
            u.usuario,
            u.email,

            u.rol_id,

            r.nombre AS rol,

            u.activo,

            e.nombre AS empresa,
            e.activo AS empresa_activa,

            u.created_at,
            u.updated_at

          FROM usuarios u

          INNER JOIN roles r
            ON r.id = u.rol_id

          INNER JOIN empresas e
            ON e.id = u.empresa_id

          WHERE u.id = ?

          LIMIT 1
        `,
        [id],
      );

    const usuario =
      rows[0] ??
      null;

    if (!usuario) {
      return null;
    }

    /*
     * Guardamos temporalmente el estado
     * de la empresa para verificarlo.
     */

    return {
      ...limpiarUsuario(
        usuario,
      ),

      empresa_activa:
        Boolean(
          usuario.empresa_activa,
        ),
    };
  };

/*
 * =====================================
 * VALIDAR ROL
 * =====================================
 */

const validarRol =
  async (
    rolId,
  ) => {
    const [rows] =
      await db.query(
        `
          SELECT
            id,
            nombre

          FROM roles

          WHERE id = ?

          LIMIT 1
        `,
        [rolId],
      );

    return (
      rows[0] ??
      null
    );
  };

/*
 * =====================================
 * INICIAR SESIÓN
 * =====================================
 */

/*
 * =====================================
 * HASH DUMMY
 * =====================================
 *
 * Cuando el identificador no coincide
 * con ningún usuario, comparamos contra
 * un hash fijo para que el tiempo de
 * respuesta no revele si la cuenta
 * existe (enumeración por timing).
 */

const HASH_DUMMY =
  "$2b$12$LJ3m4yS5zW3e0uY7Q1sZKOjQv1wKkG0VbO0y8H2m9Yv6d0nJ8v3mS";

const iniciarSesion =
  async ({
    identificador,
    password,
  }) => {
    const candidatos =
      await obtenerUsuariosPorIdentificador(
        identificador,
      );

    if (
      candidatos.length ===
      0
    ) {
      await bcrypt.compare(
        String(
          password ?? "",
        ),
        HASH_DUMMY,
      );

      const error =
        new Error(
          "El usuario, correo o contraseña son incorrectos.",
        );

      error.code =
        "CREDENCIALES_INVALIDAS";

      throw error;
    }

    /*
     * Como una cuenta puede tener
     * el mismo usuario/email en empresas
     * diferentes, verificamos cuáles
     * coinciden también por contraseña.
     */

    const coincidencias =
      [];

    for (
      const candidato
      of candidatos
    ) {
      const passwordValida =
        await bcrypt.compare(
          password,
          candidato.password,
        );

      if (
        passwordValida
      ) {
        coincidencias.push(
          candidato,
        );
      }
    }

    if (
      coincidencias.length ===
      0
    ) {
      const error =
        new Error(
          "El usuario, correo o contraseña son incorrectos.",
        );

      error.code =
        "CREDENCIALES_INVALIDAS";

      throw error;
    }

    /*
     * Si exactamente las mismas
     * credenciales existen en dos empresas,
     * NO elegimos una arbitrariamente.
     *
     * Más adelante solucionaremos esto
     * agregando código de empresa al login.
     */

    if (
      coincidencias.length >
      1
    ) {
      const error =
        new Error(
          "Las credenciales corresponden a más de una empresa.",
        );

      error.code =
        "LOGIN_AMBIGUO";

      throw error;
    }

    const usuarioEncontrado =
      coincidencias[0];

    /*
     * Usuario activo
     */

    if (
      !Boolean(
        usuarioEncontrado.activo,
      )
    ) {
      const error =
        new Error(
          "El usuario se encuentra inactivo.",
        );

      error.code =
        "USUARIO_INACTIVO";

      throw error;
    }

    /*
     * Empresa activa
     */

    if (
      !Boolean(
        usuarioEncontrado
          .empresa_activa,
      )
    ) {
      const error =
        new Error(
          "La empresa se encuentra inactiva.",
        );

      error.code =
        "EMPRESA_INACTIVA";

      throw error;
    }

    if (
      !usuarioEncontrado
        .empresa_id
    ) {
      const error =
        new Error(
          "El usuario no tiene una empresa asignada.",
        );

      error.code =
        "EMPRESA_NO_ASIGNADA";

      throw error;
    }

    const usuario =
      limpiarUsuario(
        usuarioEncontrado,
      );

    const token =
      generarToken(
        usuario,
      );

    return {
      token,
      usuario,
    };
  };

/*
 * =====================================
 * REGISTRAR USUARIO
 * =====================================
 */

const registrarUsuario =
  async ({
    empresa_id,
    nombre,
    apellido,
    usuario,
    email,
    password,
    rol_id = 2,
  }) => {
    const empresaId =
      Number(
        empresa_id,
      );

    if (
      !Number.isInteger(
        empresaId,
      ) ||
      empresaId <= 0
    ) {
      const error =
        new Error(
          "No se pudo determinar la empresa.",
        );

      error.code =
        "EMPRESA_NO_ASIGNADA";

      throw error;
    }

    /*
     * Verificamos que la empresa exista
     * y esté activa.
     */

    const [empresas] =
      await db.query(
        `
          SELECT
            id,
            nombre,
            activo

          FROM empresas

          WHERE id = ?

          LIMIT 1
        `,
        [
          empresaId,
        ],
      );

    const empresa =
      empresas[0];

    if (
      !empresa ||
      !Boolean(
        empresa.activo,
      )
    ) {
      const error =
        new Error(
          "La empresa no se encuentra activa.",
        );

      error.code =
        "EMPRESA_INACTIVA";

      throw error;
    }

    /*
     * IMPORTANTE:
     *
     * La duplicidad se controla SOLO
     * dentro de la misma empresa.
     */

    const [
      usuariosExistentes,
    ] =
      await db.query(
        `
          SELECT
            id,
            usuario,
            email

          FROM usuarios

          WHERE empresa_id = ?

            AND (
              LOWER(email) = LOWER(?)
              OR
              LOWER(usuario) = LOWER(?)
            )

          LIMIT 1
        `,
        [
          empresaId,
          email,
          usuario,
        ],
      );

    if (
      usuariosExistentes.length >
      0
    ) {
      const usuarioExistente =
        usuariosExistentes[0];

      const mismoEmail =
        String(
          usuarioExistente.email,
        ).toLowerCase() ===
        String(
          email,
        ).toLowerCase();

      const error =
        new Error(
          mismoEmail
            ? "Ya existe un usuario con ese correo electrónico dentro de la empresa."
            : "Ya existe un usuario con ese nombre de usuario dentro de la empresa.",
        );

      error.code =
        "USUARIO_DUPLICADO";

      throw error;
    }

    /*
     * Validar rol
     */

    const rol =
      await validarRol(
        rol_id,
      );

    if (!rol) {
      const error =
        new Error(
          "El rol seleccionado no existe.",
        );

      error.code =
        "ROL_NO_ENCONTRADO";

      throw error;
    }

    /*
     * Password
     */

    const passwordHash =
      await bcrypt.hash(
        password,
        12,
      );

    /*
     * Crear usuario
     */

    const [resultado] =
      await db.query(
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
          nombre,
          apellido,
          usuario,
          email,
          passwordHash,
          rol_id,
        ],
      );

    const usuarioCreado =
      await obtenerUsuarioPorId(
        resultado.insertId,
      );

    /*
     * IMPORTANTE:
     *
     * NO generamos un token nuevo.
     *
     * El administrador está creando
     * otro usuario y no queremos que
     * su sesión pase a ser la del
     * usuario recién creado.
     */

    if (
      usuarioCreado
    ) {
      delete usuarioCreado
        .empresa_activa;
    }

    return {
      usuario:
        usuarioCreado,
    };
  };

/*
 * =====================================
 * VERIFICAR TOKEN
 * =====================================
 */

const verificarToken =
  async (
    token,
  ) => {
    let datosToken;

    try {
      datosToken =
        jwt.verify(
          token,
          obtenerJwtSecret(),
        );
    } catch (
      errorOriginal
    ) {
      const error =
        new Error(
          "La sesión no es válida o ha vencido.",
        );

      error.code =
        "TOKEN_INVALIDO";

      error.originalError =
        errorOriginal;

      throw error;
    }

    /*
     * Aunque el JWT tiene empresaId,
     * volvemos a consultar el usuario.
     *
     * Así no confiamos únicamente en
     * datos antiguos del token.
     */

    const usuario =
      await obtenerUsuarioPorId(
        datosToken.userId,
      );

    if (!usuario) {
      const error =
        new Error(
          "El usuario de la sesión no existe.",
        );

      error.code =
        "USUARIO_NO_ENCONTRADO";

      throw error;
    }

    if (
      !usuario.activo
    ) {
      const error =
        new Error(
          "El usuario se encuentra inactivo.",
        );

      error.code =
        "USUARIO_INACTIVO";

      throw error;
    }

    if (
      !usuario.empresa_id
    ) {
      const error =
        new Error(
          "El usuario no tiene una empresa asignada.",
        );

      error.code =
        "EMPRESA_NO_ASIGNADA";

      throw error;
    }

    if (
      !usuario.empresa_activa
    ) {
      const error =
        new Error(
          "La empresa se encuentra inactiva.",
        );

      error.code =
        "EMPRESA_INACTIVA";

      throw error;
    }

    /*
     * Validación adicional:
     *
     * si el token tiene empresaId y
     * actualmente el usuario pertenece
     * a otra empresa, invalidamos la
     * sesión antigua.
     */

    if (
      datosToken.empresaId &&
      Number(
        datosToken.empresaId,
      ) !==
        Number(
          usuario.empresa_id,
        )
    ) {
      const error =
        new Error(
          "La empresa de la sesión ya no coincide con la del usuario.",
        );

      error.code =
        "TOKEN_INVALIDO";

      throw error;
    }

    delete usuario
      .empresa_activa;

    return usuario;
  };

module.exports = {
  iniciarSesion,

  registrarUsuario,

  verificarToken,

  obtenerUsuarioPorId,
};