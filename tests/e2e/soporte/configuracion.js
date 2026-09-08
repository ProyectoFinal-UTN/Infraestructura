import { expect } from "@playwright/test";

/**
 * Page object de `/configuracion` (HU-4, HU-5, HU-6, HU-8 y HU-31).
 *
 * Es una sola pantalla con cinco pestanas, asi que es un solo page object con
 * un grupo de locators por seccion, en vez de cinco clases que compartirian la
 * navegacion. Cada suite usa el grupo que le toca.
 *
 * La pestana viaja en la query (`?seccion=...`), asi que `ir(seccion)` entra
 * directo. `abrir(seccion)` hace el mismo recorrido pero clickeando, para los
 * tests que vienen a probar que la navegacion funciona.
 */
export class Configuracion {
  constructor(page) {
    this.page = page;

    this.titulo = page.getByRole("heading", { name: "Configuración", level: 1 });

    // Las claves son los ids de seccion tal como viajan en la query
    // (`?seccion=...`), no nombres inventados: `ir()` los usa para armar la URL,
    // asi que si no coinciden la pantalla abre en la pestana por defecto y el
    // test falla por un motivo que no tiene nada que ver con lo que prueba.
    this.pestanas = {
      perfil: page.getByRole("tab", { name: "Perfil del comercio" }),
      ubicaciones: page.getByRole("tab", { name: "Ubicaciones y moneda" }),
      usuarios: page.getByRole("tab", { name: "Usuarios y roles" }),
      auditoria: page.getByRole("tab", { name: "Auditoría" }),
      "mis-datos": page.getByRole("tab", { name: "Mis datos" }),
    };

    // HU-6 — perfil del comercio.
    this.perfil = {
      nombre: page.getByLabel("Nombre del negocio"),
      rubro: page.getByLabel("Rubro"),
      direccion: page.getByLabel("Dirección (opcional)"),
      telefono: page.getByLabel("Teléfono (opcional)"),
      correoContacto: page.getByLabel("Correo de contacto (opcional)"),
      guardar: page.getByRole("button", { name: "Guardar cambios" }),
      guardado: page.getByRole("status"),
    };

    // HU-8 — ubicaciones y moneda.
    this.ubicaciones = {
      nueva: page.getByLabel("Nombre de la ubicación"),
      agregar: page.getByRole("button", { name: "Agregar", exact: true }),
      moneda: page.getByLabel("Moneda del negocio"),
      vacio: page.getByText("Todavía no cargaste ninguna ubicación."),
      soloLectura: page.getByText("Tu rol puede consultarlas, pero no"),
      error: page.getByRole("alert"),
    };

    // HU-4 — equipo y roles.
    this.usuarios = {
      correoInvitado: page.getByLabel("Correo de la persona"),
      rolInvitado: page.getByLabel("Rol que va a tener"),
      invitar: page.getByRole("button", { name: "Invitar", exact: true }),
      avisoSoloPropietario: page.getByText(
        "Solo el propietario puede cambiar roles o invitar gente.",
      ),
      error: page.getByRole("alert"),
    };

    // HU-5 — auditoria.
    this.auditoria = {
      titulo: page.getByRole("heading", { name: "Accesos y acciones" }),
      filtroAccion: page.getByLabel("Acción"),
      filtroRecurso: page.getByLabel("Sobre qué"),
      eventos: page.getByRole("listitem"),
      error: page.getByRole("alert"),
    };

    // HU-31 — datos personales.
    this.misDatos = {
      descargar: page.getByRole("button", { name: "Descargar mis datos" }),
      quieroBaja: page.getByRole("button", { name: "Quiero darme de baja" }),
      confirmacion: page.getByLabel("Para confirmar, escribí BAJA"),
      confirmarBaja: page.getByRole("button", {
        name: "Dar de baja mi cuenta",
        exact: true,
      }),
      error: page.getByRole("alert"),
    };
  }

  /** Entra directo a una seccion por la URL. */
  async ir(seccion) {
    await this.page.goto(`/configuracion?seccion=${seccion}`);
    await expect(this.titulo).toBeVisible();
    await expect(this.pestanas[seccion]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }

  /** Entra a `/configuracion` y cambia de pestana clickeando. */
  async abrir(seccion) {
    await this.page.goto("/configuracion");
    await expect(this.titulo).toBeVisible();
    await this.pestanas[seccion].click();
    await expect(this.pestanas[seccion]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }

  /**
   * Los eventos de auditoria cuyo texto coincide.
   *
   * Acotado a la lista a proposito: un `page.getByText("Inició sesión")` suelto
   * matchea primero el `<option>` del filtro, que tiene el mismo texto y nunca
   * esta visible. El test falla entonces por el desplegable, no por el registro.
   */
  eventoDeAuditoria(texto) {
    return this.auditoria.eventos.filter({ hasText: texto });
  }

  /** La fila de una ubicacion, por su nombre. */
  filaUbicacion(nombre) {
    return this.page.getByRole("listitem").filter({ hasText: nombre });
  }

  /** Da de alta una ubicacion por la UI y espera a que aparezca en la lista. */
  async agregarUbicacion(nombre) {
    await this.ubicaciones.nueva.fill(nombre);
    await this.ubicaciones.agregar.click();
  }
}
