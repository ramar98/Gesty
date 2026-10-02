const multer = require("multer");
const path = require("path");
const fs = require("fs");

/*
 * =====================================
 * VOLUME
 * =====================================
 *
 * Railway define automáticamente:
 *
 * RAILWAY_VOLUME_MOUNT_PATH=/app/uploads
 *
 * En desarrollo local, donde esa
 * variable no existe, usamos:
 *
 * <proyecto>/uploads
 */

const uploadsRoot =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(
    process.cwd(),
    "uploads",
  );

const productosDir =
  path.join(
    uploadsRoot,
    "productos",
  );

/*
 * Creamos la carpeta si no existe.
 */

fs.mkdirSync(
  productosDir,
  {
    recursive: true,
  },
);

/*
 * =====================================
 * DEBUG
 * =====================================
 */

console.log(
  "======================================",
);

console.log(
  "RAILWAY_VOLUME_MOUNT_PATH:",
  process.env
    .RAILWAY_VOLUME_MOUNT_PATH ||
    "NO DEFINIDO",
);

console.log(
  "Carpeta física de imágenes:",
  productosDir,
);

console.log(
  "======================================",
);

/*
 * =====================================
 * STORAGE
 * =====================================
 */

const storage =
  multer.diskStorage({
    destination: (
      req,
      file,
      cb,
    ) => {
      cb(
        null,
        productosDir,
      );
    },

    filename: (
      req,
      file,
      cb,
    ) => {
      const extension =
        path
          .extname(
            file.originalname,
          )
          .toLowerCase();

      const nombreBase =
        path
          .basename(
            file.originalname,
            extension,
          )
          .replace(
            /[^a-zA-Z0-9-_]/g,
            "_",
          );

      const nombre =
        `${Date.now()}-${nombreBase}${extension}`;

      cb(
        null,
        nombre,
      );
    },
  });

/*
 * =====================================
 * FILTRO
 * =====================================
 */

const EXTENSIONES_PERMITIDAS =
  [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
  ];

const fileFilter = (
  req,
  file,
  cb,
) => {
  const tiposPermitidos = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  /*
   * El mimetype lo informa el cliente
   * y puede ser falsificado, así que
   * también verificamos la extensión.
   */

  const extension =
    path
      .extname(
        file.originalname,
      )
      .toLowerCase();

  const valido =
    tiposPermitidos.includes(
      file.mimetype,
    ) &&
    EXTENSIONES_PERMITIDAS.includes(
      extension,
    );

  if (valido) {
    cb(
      null,
      true,
    );
  } else {
    cb(
      new Error(
        "Solo se permiten imágenes JPG, PNG o WEBP.",
      ),
      false,
    );
  }
};

/*
 * ===================================
 * MULTER
 * ===================================
 */

const upload =
  multer({
    storage,

    fileFilter,

    limits: {
      fileSize:
        5 *
        1024 *
        1024,
    },
  });

module.exports =
  upload;