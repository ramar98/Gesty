/*
 * =====================================================
 * EJECUTAR UN ARCHIVO SQL
 *
 * Uso:
 *   node scripts/ejecutarSql.js <archivo.sql>
 *
 * Ejemplo (base nueva de pruebas):
 *   node scripts/ejecutarSql.js database/stock.sql
 *
 * Usa las credenciales DB_* / MYSQL* de .env,
 * con multipleStatements habilitado.
 * =====================================================
 */

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config();

async function main() {
  const archivo = process.argv[2];

  if (!archivo) {
    console.error(
      "Uso: node scripts/ejecutarSql.js <archivo.sql>",
    );
    process.exit(1);
  }

  const ruta = path.resolve(archivo);
  const sql = fs.readFileSync(ruta, "utf8");

  const connection = await mysql.createConnection({
    host:
      process.env.DB_HOST ||
      process.env.MYSQLHOST,
    port: Number(
      process.env.DB_PORT ||
        process.env.MYSQLPORT ||
        3306,
    ),
    user:
      process.env.DB_USER ||
      process.env.MYSQLUSER,
    password:
      process.env.DB_PASSWORD ||
      process.env.MYSQLPASSWORD,
    database:
      process.env.DB_DATABASE ||
      process.env.MYSQLDATABASE,
    multipleStatements: true,
  });

  console.log(
    `Conectado a ${connection.config.host}:${connection.config.port}/${connection.config.database}`,
  );

  await connection.query(sql);

  console.log(
    `✔ ${archivo} ejecutado correctamente.`,
  );

  await connection.end();
}

main().catch((error) => {
  console.error(
    "Error ejecutando el SQL:",
    error.message,
  );
  process.exit(1);
});
