const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

const archivoSql = path.resolve(__dirname, "../database/migration_suscripciones.sql");

function obtenerDefiniciones() {
  return fs.readFileSync(archivoSql, "utf8").split(";").map((sql) => sql.trim())
    .filter((sql) => /^CREATE TABLE /i.test(sql)).map((sql) => ({
      tabla: sql.match(/^CREATE TABLE (\w+)/i)[1],
      columnas: sql.split("\n").flatMap((linea) => {
        const match = linea.match(/^\s*(\w+)\s+(?:int|varchar|enum|decimal|tinyint|datetime|timestamp|json)\b/i);
        return match ? [match[1]] : [];
      }),
      sql,
    }));
}

async function crearPlan(connection) {
  const [columnas] = await connection.query(
    `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, DATA_TYPE AS tipo
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('empresas', 'roles', 'codigos_promocionales', 'pagos_suscripcion', 'pagos_registro')`,
  );
  const tablas = new Map();
  for (const columna of columnas) {
    if (!tablas.has(columna.tabla)) tablas.set(columna.tabla, new Map());
    tablas.get(columna.tabla).set(columna.columna, columna.tipo);
  }
  for (const tabla of ["empresas", "roles"]) {
    if (!tablas.get(tabla)?.has("id") || (tabla === "roles" && !tablas.get(tabla).has("nombre"))) {
      throw new Error(`Falta el esquema base de ${tabla}. Esta migración no importa ni reemplaza la base completa.`);
    }
  }
  const plan = [];
  const vencimiento = tablas.get("empresas").get("suscripcion_vence");
  if (!vencimiento) {
    plan.push({ descripcion: "Agregar empresas.suscripcion_vence", sql: "ALTER TABLE empresas ADD COLUMN suscripcion_vence DATETIME NULL DEFAULT NULL" });
  } else if (!["datetime", "timestamp"].includes(vencimiento)) {
    throw new Error("empresas.suscripcion_vence tiene un tipo incompatible. Requiere revisión antes de migrar.");
  }
  for (const definicion of obtenerDefiniciones()) {
    if (!tablas.has(definicion.tabla)) {
      plan.push({ descripcion: `Crear ${definicion.tabla}`, sql: definicion.sql });
    } else {
      const faltantes = definicion.columnas.filter((columna) => !tablas.get(definicion.tabla).has(columna));
      if (faltantes.length) {
        throw new Error(`${definicion.tabla} existe pero faltan columnas: ${faltantes.join(", ")}. No se modificará automáticamente esa tabla.`);
      }
    }
  }
  const [roles] = await connection.query("SELECT id FROM roles WHERE LOWER(nombre) = LOWER(?) LIMIT 1", ["Superadmin"]);
  if (!roles.length) {
    plan.push({ descripcion: "Agregar rol Superadmin", sql: "INSERT INTO roles (nombre) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(nombre) = LOWER(?))", parametros: ["Superadmin", "Superadmin"] });
  }
  return plan;
}

function leerConexion(archivo, permitirLocal = false) {
  // No cargar .env por defecto: el destino debe indicarse explícitamente.
  const env = dotenv.parse(fs.readFileSync(path.resolve(archivo)));
  const url = env.MYSQL_PUBLIC_URL || env.DATABASE_URL;
  let config;
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "mysql:") throw new Error("La conexión debe ser de MySQL.");
    config = { host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), database: decodeURIComponent(parsed.pathname.slice(1)) };
  } else {
    config = { host: env.DB_HOST || env.MYSQLHOST, port: Number(env.DB_PORT || env.MYSQLPORT || 3306), user: env.DB_USER || env.MYSQLUSER, password: env.DB_PASSWORD || env.MYSQLPASSWORD || "", database: env.DB_DATABASE || env.MYSQLDATABASE };
  }
  if (!config.host || !config.user || !config.database || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("Faltan datos de conexión o el puerto no es válido. Usá MYSQL_PUBLIC_URL o DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y DB_DATABASE.");
  }
  if (!permitirLocal && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(config.host.toLowerCase())) {
    throw new Error("El destino es local. Para Railway usá el host del proxy público. --permitir-local habilita pruebas explícitas.");
  }
  if (env.MYSQL_SSL === "true") config.ssl = { rejectUnauthorized: true };
  return { ...config, connectTimeout: 10000 };
}

async function main(args = process.argv.slice(2)) {
  const posicion = args.indexOf("--env");
  if (posicion === -1 || !args[posicion + 1]) {
    throw new Error("Uso: node scripts/migrarSuscripciones.js --env .env.railway [--aplicar] [--permitir-local]");
  }
  const config = leerConexion(args[posicion + 1], args.includes("--permitir-local"));
  const connection = await mysql.createConnection(config);
  let bloqueo = false;
  const lock = `gesty_suscripciones_${crypto.createHash("sha256").update(config.database).digest("hex").slice(0, 32)}`;
  try {
    console.log(`Destino: ${config.host}:${config.port}/${config.database}`);
    if (args.includes("--aplicar")) {
      const [rows] = await connection.query("SELECT GET_LOCK(?, 10) AS adquirido", [lock]);
      if (Number(rows[0]?.adquirido) !== 1) throw new Error("Otra migración está en curso. No se aplicaron cambios.");
      bloqueo = true;
    }
    const plan = await crearPlan(connection);
    if (!plan.length) { console.log("El esquema de suscripciones ya está actualizado."); return; }
    for (const paso of plan) console.log(`Pendiente: ${paso.descripcion}`);
    if (!args.includes("--aplicar")) {
      console.log("Solo inspección: no se modificó la base. Agregá --aplicar para ejecutar este plan.");
      return;
    }
    const directorio = path.resolve(__dirname, "../database/schema-backups");
    fs.mkdirSync(directorio, { recursive: true });
    const archivo = path.join(directorio, `suscripciones-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
    const esquemas = [];
    for (const tabla of ["empresas", "roles", ...obtenerDefiniciones().map((d) => d.tabla)]) {
      const [existe] = await connection.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [tabla]);
      if (!existe.length) continue;
      const [rows] = await connection.query(`SHOW CREATE TABLE \`${tabla}\``);
      esquemas.push(rows[0]["Create Table"] + ";");
    }
    fs.writeFileSync(archivo, esquemas.join("\n\n") + "\n", { flag: "wx" });
    console.log(`Respaldo del esquema previo: ${archivo} (no contiene filas de datos).`);
    // MySQL confirma DDL de forma implícita: cada paso es aditivo y se puede reanudar.
    for (const paso of plan) {
      await connection.query(paso.sql, paso.parametros);
      console.log(`Aplicado: ${paso.descripcion}`);
    }
    if ((await crearPlan(connection)).length) throw new Error("La verificación final encontró pasos pendientes.");
    console.log("Migración aplicada y verificada. Los datos existentes se conservaron.");
  } finally {
    try { if (bloqueo) await connection.query("SELECT RELEASE_LOCK(?)", [lock]); }
    finally { await connection.end(); }
  }
}

if (require.main === module) {
  main().catch((error) => {
    // No imprimir el objeto de conexión ni URLs con contraseñas.
    console.error(`Migración detenida${error.code ? ` (${error.code})` : ""}: ${error.code ? "No se pudo completar la operación de MySQL; revisá la conexión y el esquema." : error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { crearPlan, leerConexion, obtenerDefiniciones };
