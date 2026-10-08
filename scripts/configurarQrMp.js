/*
 * =====================================================
 * CONFIGURAR QR DE MERCADO PAGO
 *
 * Crea en la cuenta de MP:
 *   - una sucursal ("store")
 *   - una caja/POS con QR dinámico
 *
 * Imprime las variables que hay que
 * poner en el .env:
 *   MP_COLLECTOR_ID
 *   MP_POS_EXTERNAL_ID
 *
 * Uso:
 *   node scripts/configurarQrMp.js
 *
 * Es idempotente: si la sucursal/caja
 * ya existen las reutiliza.
 * =====================================================
 */

require("dotenv").config();

const BASE =
  "https://api.mercadopago.com";

const token =
  process.env.MP_ACCESS_TOKEN;

const STORE_EXTERNAL_ID =
  "GESTY-WEB";

const POS_EXTERNAL_ID =
  "GESTYWEB1";

async function api(path, options = {}) {
  const respuesta = await fetch(
    `${BASE}${path}`,
    {
      ...options,
      headers: {
        Authorization:
          `Bearer ${token}`,
        "Content-Type":
          "application/json",
        ...(options.headers ?? {}),
      },
    },
  );

  const datos =
    await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(
      `MP ${path}: ${respuesta.status} ${JSON.stringify(datos)}`,
    );
  }

  return datos;
}

async function main() {
  if (!token) {
    console.error(
      "Falta MP_ACCESS_TOKEN en el .env",
    );
    process.exit(1);
  }

  /*
   * 1. Usuario cobrador
   */

  const usuario =
    await api("/users/me");

  console.log(
    `Cuenta MP: ${usuario.email} (id ${usuario.id})`,
  );

  /*
   * 2. Sucursal (la reutilizamos si
   * ya existe una con ese
   * external_id)
   */

  let store = null;

  try {
    const stores = await api(
      `/users/${usuario.id}/stores/search?external_id=${STORE_EXTERNAL_ID}`,
    );

    store = stores.results?.[0];
  } catch {
    /*
     * 404 = no existe todavía: la
     * creamos abajo.
     */
  }

  if (!store) {
    store = await api(
      `/users/${usuario.id}/stores`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Gesty Web",
          external_id:
            STORE_EXTERNAL_ID,
          location: {
            street_name: "S/N",
            street_number: "S/N",
            city_name: "Palermo",
            state_name:
              "Capital Federal",
            latitude: -34.6037,
            longitude: -58.3816,
            reference: "Gesty Web",
          },
        }),
      },
    );

    console.log(
      `Sucursal creada: ${store.id}`,
    );
  } else {
    console.log(
      `Sucursal existente: ${store.id}`,
    );
  }

  /*
   * 3. Caja/POS con QR dinámico
   */

  let pos = null;

  try {
    const poses = await api(
      `/pos?external_id=${POS_EXTERNAL_ID}`,
    );

    pos = poses.results?.[0];
  } catch {
    /* 404 = no existe: se crea abajo */
  }

  if (!pos) {
    pos = await api("/pos", {
      method: "POST",
      body: JSON.stringify({
        name: "Caja Web Gesty",
        external_id:
          POS_EXTERNAL_ID,
        store_id: store.id,
        fixed_amount: false,
        category: 621102,
      }),
    });

    console.log(
      `Caja creada: ${pos.id}`,
    );
  } else {
    console.log(
      `Caja existente: ${pos.id}`,
    );
  }

  /*
   * 4. Variables para el .env
   */

  console.log(
    "\nAgregá esto a tu .env:\n",
  );

  console.log(
    `MP_COLLECTOR_ID=${usuario.id}`,
  );

  console.log(
    `MP_POS_EXTERNAL_ID=${POS_EXTERNAL_ID}`,
  );
}

main().catch((error) => {
  console.error(
    "Error:",
    error.message,
  );
  process.exit(1);
});
