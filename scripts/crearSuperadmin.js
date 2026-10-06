/*
 * =====================================================
 * CREAR USUARIO SUPERADMIN
 *
 * Uso:
 *   node scripts/crearSuperadmin.js <usuario> <email> <password>
 *
 * Crea (si no existen):
 *   - rol "Superadmin"
 *   - empresa interna "Gesty Platform"
 *   - el usuario superadmin
 *
 * Requiere la migración migration_suscripciones.sql
 * aplicada previamente.
 * =====================================================
 */

const bcrypt = require("bcryptjs");

require("dotenv").config();

const db = require("../config/db");

async function main() {
  const [usuario, email, password] =
    process.argv.slice(2);

  if (
    !usuario ||
    !email ||
    !password ||
    password.length < 8
  ) {
    console.error(
      "Uso: node scripts/crearSuperadmin.js <usuario> <email> <password>\n" +
        "La contraseña debe tener al menos 8 caracteres.",
    );

    process.exit(1);
  }

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    /*
     * Rol SUPERADMIN
     */

    await connection.query(
      `
        INSERT IGNORE INTO roles (nombre)
        VALUES ('Superadmin')
      `,
    );

    const [roles] = await connection.query(
      `
        SELECT id FROM roles
        WHERE LOWER(nombre) = 'superadmin'
        LIMIT 1
      `,
    );

    const rolId = roles[0]?.id;

    if (!rolId) {
      throw new Error(
        "No se pudo obtener el rol Superadmin.",
      );
    }

    /*
     * Empresa interna de la plataforma
     * (los usuarios requieren empresa_id).
     * No le cobramos suscripción: el
     * superadmin no pasa por el control.
     */

    await connection.query(
      `
        INSERT INTO empresas (nombre, plan)
        SELECT 'Gesty Platform', 'INTERNA'
        WHERE NOT EXISTS (
          SELECT 1 FROM empresas
          WHERE nombre = 'Gesty Platform'
        )
      `,
    );

    const [empresas] =
      await connection.query(
        `
          SELECT id FROM empresas
          WHERE nombre = 'Gesty Platform'
          LIMIT 1
        `,
      );

    const empresaId = empresas[0].id;

    /*
     * Usuario
     */

    const passwordHash = await bcrypt.hash(
      password,
      12,
    );

    await connection.query(
      `
        INSERT INTO usuarios
        (
          empresa_id,
          nombre,
          usuario,
          email,
          password,
          rol_id,
          activo
        )

        VALUES (?, 'Superadmin', ?, ?, ?, ?, TRUE)
      `,
      [
        empresaId,
        usuario,
        email,
        passwordHash,
        rolId,
      ],
    );

    await connection.commit();

    console.log(
      `Superadmin "${usuario}" creado correctamente.`,
    );
  } catch (error) {
    await connection.rollback();

    if (error.code === "ER_DUP_ENTRY") {
      console.error(
        "Ya existe un usuario con ese usuario o email en esa empresa.",
      );
    } else {
      console.error(
        "Error creando superadmin:",
        error.message,
      );
    }

    process.exitCode = 1;
  } finally {
    connection.release();

    await db.end();
  }
}

main();
