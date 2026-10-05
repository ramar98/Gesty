const suscripcionesService = require(
  "../services/suscripcionesService",
);

/*
 * =====================================
 * SUSCRIPCIÓN ACTIVA
 *
 * Corre después de
 * verificarAutenticacion. Bloquea el
 * acceso a los módulos de negocio si
 * la empresa no tiene suscripción
 * vigente.
 *
 * El superadmin nunca se bloquea:
 * administra la plataforma.
 * =====================================
 */

async function verificarSuscripcionActiva(
  req,
  res,
  next,
) {
  try {
    const rol = String(
      req.usuario?.rol ?? "",
    )
      .trim()
      .toUpperCase();

    if (rol === "SUPERADMIN") {
      return next();
    }

    const alDia =
      await suscripcionesService.estaAlDia(
        req.empresaId,
      );

    if (!alDia) {
      return res
        .status(402)
        .json({
          success: false,

          message:
            "La suscripción de la empresa está vencida.",

          error: {
            code:
              "SUSCRIPCION_VENCIDA",
          },
        });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  verificarSuscripcionActiva,
};
