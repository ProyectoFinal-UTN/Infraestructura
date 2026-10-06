import { expect } from "@playwright/test";

/**
 * Page object del control de acceso por rol (HU-32).
 *
 * Es transversal a cuatro pantallas —Inicio, Productos, Configuracion y la
 * seccion Usuarios— porque lo que se prueba no es una pantalla sino una regla
 * que atraviesa a todas: que cada rol vea exactamente lo que le toca.
 *
 * Va por `data-testid` y no por rol/etiqueta como el resto de los page objects
 * de este repo. No es un cambio de criterio: HU-32 agrego los testids justamente
 * para esto, porque la pregunta que hay que hacerle al DOM es «esta o no esta»,
 * y para eso un identificador estable es mas honesto que un texto visible que
 * cambia con la redaccion. Los campos siguen yendo por etiqueta.
 *
 * Por eso ademas vive en su propio archivo en vez de sumarse a
 * `configuracion.js` o `catalogo.js`: esos ubican todo por rol y etiqueta, y
 * mezclar las dos convenciones en un archivo que usan cinco specs deja a
 * cualquiera adivinando cual aplica.
 *
 * LO QUE RESUELVE DE UNA VEZ: los estados de carga. La mitad de las
 * aserciones de HU-32 son de ausencia, y una ausencia se puede cumplir por la
 * razon equivocada. Peor: el estado intermedio NO va para el mismo lado en
 * todas las pantallas.
 *
 *   - Inicio y Productos arrancan con TODO oculto (`resuelto &&` en cada
 *     acceso, y `puedeSalvoQueFalle` devuelve false mientras carga). Un
 *     `toHaveCount(0)` apenas carga la pagina pasa siempre, incluso para el
 *     propietario.
 *   - Configuracion arranca con las CINCO pestañas visibles: filtra con
 *     `seSabe ? filtrar : SECCIONES`, o sea que mientras no sabe muestra todo.
 *     Una ausencia aca empieza siendo falsa y se vuelve verdadera.
 *
 * De ahi los tres `esperar*` de abajo. No son azucar: son la diferencia entre
 * un test que prueba algo y uno que no.
 */

/** Textos de carga, con la elipsis de un caracter (U+2026), no tres puntos. */
const CARGANDO = {
  inicio: "Cargando accesos…",
  productos: "Cargando productos…",
  configuracion: "Cargando datos…",
};

export class Accesos {
  constructor(page) {
    this.page = page;

    this.inicio = {
      registrarMovimiento: page.getByTestId("acceso-registrar-movimiento"),
      historial: page.getByTestId("acceso-historial"),
      transferir: page.getByTestId("acceso-transferir"),
      productos: page.getByTestId("acceso-productos"),
      escanear: page.getByTestId("acceso-escanear"),
      configuracion: page.getByTestId("acceso-configuracion"),
    };

    this.productos = {
      importarCsv: page.getByTestId("productos-importar-csv"),
      escanear: page.getByTestId("productos-escanear"),
      nuevoManual: page.getByTestId("productos-nuevo-manual"),
      soloLectura: page.getByTestId("productos-solo-lectura"),
    };

    this.pestanas = {
      perfil: page.getByTestId("pestana-perfil"),
      ubicaciones: page.getByTestId("pestana-ubicaciones"),
      usuarios: page.getByTestId("pestana-usuarios"),
      auditoria: page.getByTestId("pestana-auditoria"),
      misDatos: page.getByTestId("pestana-mis-datos"),
    };

    this.usuarios = {
      invitar: page.getByTestId("usuarios-invitar"),
      soloLectura: page.getByTestId("usuarios-solo-lectura"),
    };

    this.detalleTransferir = page.getByTestId("detalle-transferir");

    // Los cuatro avisos de `services/errores.js`, mas el cartel de la guarda de
    // ruta. `AvisoDeError` no recibe el testId por prop: los tiene hardcodeados
    // en un `Recuadro` privado, uno por tipo de fallo.
    this.avisoSesion = page.getByTestId("aviso-sesion");
    this.avisoPermiso = page.getByTestId("aviso-permiso");
    this.avisoCuenta = page.getByTestId("aviso-cuenta");
    this.avisoGeneral = page.getByTestId("aviso-general");
    this.sinPermiso = page.getByTestId("sin-permiso");

    // El link del aviso de sesion vencida. Dice «Volver a entrar», no
    // «Iniciar sesion».
    this.volverAEntrar = page.getByRole("link", { name: "Volver a entrar" });
  }

  /**
   * Entra al Inicio y espera a que los permisos hayan llegado.
   *
   * Ancla en `acceso-productos` y no en `acceso-configuracion`: Configuracion
   * es el unico acceso sin gate de permiso NI de `resuelto`, asi que esta
   * visible incluso mientras la pantalla dice «Cargando accesos…». Esperarlo
   * no probaria nada. `acceso-productos` pide `producto:read`, que los tres
   * roles tienen, asi que sirve de ancla para los tres.
   */
  async irAInicio() {
    await this.page.goto("/");
    await expect(this.inicio.productos).toBeVisible();
    await expect(this.page.getByText(CARGANDO.inicio)).toHaveCount(0);
  }

  /**
   * Entra al catalogo y espera a que los permisos hayan llegado.
   *
   * Ancla en la fila del producto porque `SeccionProductos` recien se monta con
   * `!cargando && resuelto && !error`: si la fila esta, los permisos llegaron.
   * NO sirve anclar en `productos-importar-csv`, que vive en el `<header>`,
   * fuera de ese gate, y aparece en otro momento.
   */
  async irAProductos(producto) {
    await this.page.goto("/productos");
    await expect(
      this.page.getByRole("listitem").filter({ hasText: producto.codigoBarras }),
    ).toBeVisible();
    await expect(this.page.getByText(CARGANDO.productos)).toHaveCount(0);
  }

  /**
   * Entra a Configuracion y espera a que las pestañas se hayan decidido.
   *
   * Aca el ancla tiene que ser la DESAPARICION del «Cargando datos…», no la
   * aparicion de algo: las cinco pestañas arrancan visibles (ver el comentario
   * de arriba), asi que esperar a ver una no dice nada sobre si ya se filtraron.
   */
  async irAConfiguracion(seccion) {
    const query = seccion ? `?seccion=${seccion}` : "";
    await this.page.goto(`/configuracion${query}`);
    await expect(
      this.page.getByRole("heading", { name: "Configuración", level: 1 }),
    ).toBeVisible();
    await expect(this.page.getByText(CARGANDO.configuracion)).toHaveCount(0);
  }

  /** La fila del equipo de esa persona, para mirar lo que tiene al lado. */
  filaDeMiembro(correo) {
    return this.page.getByRole("listitem").filter({ hasText: correo });
  }

  /**
   * El `<select>` de rol de un miembro. `miembroId` es el `member.id`.
   *
   * Ojo: la fila de uno mismo NO lo tiene, ni siquiera siendo propietario
   * (`esUnoMismo` compara `miembro.userId`). Para verificar que el propietario
   * puede cambiar roles hay que mirar la fila de OTRO.
   */
  rolDeMiembro(miembroId) {
    return this.page.getByTestId(`usuario-rol-${miembroId}`);
  }

  quitarMiembro(miembroId) {
    return this.page.getByTestId(`usuario-quitar-${miembroId}`);
  }

  editarProducto(producto) {
    return this.page.getByTestId(`producto-editar-${producto.id}`);
  }

  eliminarProducto(producto) {
    return this.page.getByTestId(`producto-eliminar-${producto.id}`);
  }
}
