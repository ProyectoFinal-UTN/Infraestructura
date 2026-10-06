import { expect, test } from "../soporte/fixtures.js";
import { Accesos } from "./soporte/accesos.js";
import { Catalogo } from "./soporte/catalogo.js";
import { Configuracion } from "./soporte/configuracion.js";
import { Historial } from "./soporte/historial.js";
import {
  abrirComo,
  cambiarRolViaApi,
  leerMiembros,
  miembroPorCorreo,
  sumarMiembro,
} from "../soporte/equipo.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  leerUbicaciones,
  registrarMovimientoViaApi,
  ubicacionPorNombre,
} from "../soporte/datos.js";
import { UBICACION_POR_DEFECTO } from "./soporte/movimientos.js";

/**
 * E2E de HU-32 — control de acceso por rol (SCRUM-44, RF9, RNF4).
 *
 * QUE CUBRE ESTA CAPA Y NINGUNA OTRA
 *
 * El recorrido en un navegador real con los tres roles logueados, contra el
 * stack completo detras de Nginx. El Backend ya verifica endpoint por endpoint
 * con supertest, y el Frontend ya verifica `puede()` y las carreras con
 * unitarios; lo que nadie verificaba es que un empleado, con su cookie de
 * verdad, no VEA ni ALCANCE lo que no le toca. El reporte de HU-32 del Frontend
 * lo deja anotado como pendiente: es este archivo.
 *
 * LO QUE A PROPOSITO NO SE REPITE ACA
 *
 * - Que `permisosDe(rol)` devuelva exactamente lo que corresponde, y que este
 *   atado a `puede()`: Backend (`lib/permissions.js` + `permissions.test.js` +
 *   `controlAcceso.test.js`). Duplicarlo seria reescribir una tabla.
 * - El 403 de cada endpoint, uno por uno: Backend (`controlAcceso.test.js`).
 *   Aca se prueban solo los dos que la UI puede alcanzar escribiendo la URL.
 * - Los cinco bugs de condicion de carrera y su arreglo con el contador de
 *   generacion: Frontend, unitarios con dos respuestas en vuelo. Reproducir
 *   eso desde un navegador seria pelearle al timing sin ganar informacion.
 * - El fail-open (si `/api/configuracion` falla, la UI muestra todo) y el
 *   fail-closed (si la respuesta llega sin `permisos`, no muestra nada):
 *   Frontend, unitarios. Aca se los EVITA activamente, ver abajo.
 *
 * TRES TRAMPAS QUE ESTE ARCHIVO TIENE QUE ESQUIVAR
 *
 * 1. Bloquear `/api/configuracion` NO simula un rol sin permiso. Dispara el
 *    fail-open: `puedeSalvoQueFalle` devuelve true ante error y `RutaProtegida`
 *    hace `return children`, asi que se verian TODOS los botones, no ninguno.
 *    Un rol sin permiso se prueba con un rol real logueado y nada mas. Por eso
 *    en todo el archivo no hay un solo `page.route`.
 * 2. Los estados de carga no van todos para el mismo lado: Inicio y Productos
 *    arrancan vacios, Configuracion arranca con las cinco pestañas. Las esperas
 *    estan resueltas en los `irA*` de `soporte/accesos.js`, que es el lugar
 *    donde esta explicado cual es el ancla de cada pantalla y por que.
 * 3. El correo del historial es el fallback del nombre, no un campo aparte, asi
 *    que por pantalla no se puede distinguir "lo recorto" de "mostro el
 *    nombre". Se verifica sobre el payload; ver `soporte/historial.js`.
 */

/**
 * La matriz, celda por celda, verificada contra el codigo de `origin/dev` de
 * los dos repos y no contra documentacion.
 *
 * Vive como dato y no como siete tests sueltos porque es una tabla: leerla al
 * lado de la de `Backend/src/lib/permissions.js` tiene que ser trivial, y
 * agregar un rol o un acceso tiene que ser una linea.
 *
 * `null` = no aplica (el rol no llega ni a la pantalla donde vive el control).
 */
const MATRIZ = {
  propietario: {
    inicio: {
      registrarMovimiento: true,
      historial: true,
      transferir: true,
      productos: true,
      escanear: true,
      configuracion: true,
    },
    productos: {
      importarCsv: true,
      escanear: true,
      nuevoManual: true,
      soloLectura: false,
      editarYEliminar: true,
    },
    pestanas: {
      perfil: true,
      ubicaciones: true,
      usuarios: true,
      auditoria: true,
      misDatos: true,
    },
    usuarios: {
      invitar: true,
      soloLectura: false,
      // Solo en la fila de OTRO: `esUnoMismo` saca el select y el boton de la
      // fila propia, incluso siendo propietario.
      cambiarYQuitarAOtro: true,
    },
  },

  gerente: {
    inicio: {
      registrarMovimiento: true,
      historial: true,
      transferir: true,
      productos: true,
      escanear: true,
      configuracion: true,
    },
    productos: {
      importarCsv: true,
      escanear: true,
      nuevoManual: true,
      soloLectura: false,
      editarYEliminar: true,
    },
    pestanas: {
      perfil: true,
      ubicaciones: true,
      // Entra a Usuarios, pero de solo lectura: tiene `member:read` y nada mas.
      usuarios: true,
      auditoria: false,
      misDatos: true,
    },
    usuarios: {
      invitar: false,
      soloLectura: true,
      cambiarYQuitarAOtro: false,
    },
  },

  empleado: {
    inicio: {
      registrarMovimiento: true,
      historial: true,
      // Tiene `transferencia:create`, que HU-32 separo de `movimiento:create`.
      transferir: true,
      productos: true,
      // Lo unico que pierde en el Inicio: escanear exige `producto:create`.
      escanear: false,
      configuracion: true,
    },
    productos: {
      importarCsv: false,
      escanear: false,
      nuevoManual: false,
      soloLectura: true,
      editarYEliminar: false,
    },
    pestanas: {
      perfil: true,
      ubicaciones: true,
      usuarios: false,
      auditoria: false,
      misDatos: true,
    },
    // No llega a la seccion Usuarios: sin `member:read` la pestaña no existe.
    usuarios: null,
  },
};

const ROLES = Object.keys(MATRIZ);

/**
 * Afirma presencia o ausencia segun la matriz.
 *
 * La ausencia va con `toHaveCount(0)` y no con `toBeDisabled()` porque HU-32
 * esconde, no deshabilita: los elementos no estan en el DOM. En el caso del
 * escaneo eso es deliberado y no se puede cambiar — no hay variante de lectura
 * (`GET /api/productos/codigo/:codigoBarras` exige `producto:create`), asi que
 * al empleado no se le puede ofrecer un boton gris con un tooltip: no habria
 * nada detras.
 */
async function afirmar(locator, esperado, queEs) {
  if (esperado) {
    await expect(locator, `${queEs} tendria que estar visible`).toBeVisible();
  } else {
    await expect(locator, `${queEs} no tendria que existir`).toHaveCount(0);
  }
}

/** Producto + segunda ubicacion, lo minimo para que las pantallas tengan algo. */
async function armarEscenario(api) {
  const producto = await crearProductoViaApi(api);
  await crearUbicacionViaApi(api, "Depósito");

  return producto;
}

test.describe("HU-32 — Control de acceso por rol", () => {
  test.describe("Matriz de visibilidad", () => {
    /**
     * Un test por rol y no uno por celda: son ~57 celdas, y 57 tests levantarian
     * 57 comercios para preguntar 57 veces lo mismo. El recorrido es el sujeto
     * —Inicio, Productos, Configuracion, Usuarios con una sola sesion— y el
     * mensaje de cada `expect` dice que celda fallo.
     */
    for (const rol of ROLES) {
      test(`el ${rol} ve exactamente lo que le toca`, async ({
        page,
        api,
        playwright,
        browser,
      }) => {
        // Este test hace mucho de verdad: hasta dos altas por API —cada una es
        // una invitacion mas un sign-up contra Neon— y cuatro cargas completas
        // de pantalla. Medido, tarda entre 15s y 35s, o sea que con los 45s por
        // defecto el margen es de uno o dos pedidos lentos. Ya se paso una vez,
        // y el sintoma era enganoso: timeout esperando que se fuera un
        // «Cargando datos…» que SI se iba a ir.
        //
        // No es un retry ni un tope para esquivar un bug: es margen para la
        // latencia de Neon en un recorrido de cuatro pantallas, declarado donde
        // se ve. Si algun dia tampoco alcanza, lo que hay que mirar es cuanto
        // tarda el andamiaje, no subir mas este numero.
        test.slow();

        const esperado = MATRIZ[rol];
        const producto = await armarEscenario(api);

        // El propietario es el del fixture; los otros dos se suman al MISMO
        // comercio. Dos comercios distintos probarian el aislamiento entre
        // tenants, que es otra cosa.
        const propio = rol === "propietario";
        const miembro = propio
          ? null
          : await sumarMiembro(playwright, api, { rol });

        // Hace falta un segundo miembro siempre: para el propietario, porque
        // los controles de rol no aparecen en la fila propia; para el gerente,
        // porque tiene que haber alguien a quien NO pueda tocar.
        const otro =
          esperado.usuarios === null
            ? null
            : await sumarMiembro(playwright, api, { rol: "empleado" });

        const { context, page: pagina } = propio
          ? { context: null, page }
          : await abrirComo(browser, miembro.storageState);

        try {
          const accesos = new Accesos(pagina);

          await test.step("Inicio", async () => {
            await accesos.irAInicio();

            for (const [clave, visible] of Object.entries(esperado.inicio)) {
              await afirmar(
                accesos.inicio[clave],
                visible,
                `acceso "${clave}" para ${rol}`,
              );
            }
          });

          await test.step("Productos", async () => {
            await accesos.irAProductos(producto);

            for (const clave of [
              "importarCsv",
              "escanear",
              "nuevoManual",
              "soloLectura",
            ]) {
              await afirmar(
                accesos.productos[clave],
                esperado.productos[clave],
                `"${clave}" de Productos para ${rol}`,
              );
            }

            await afirmar(
              accesos.editarProducto(producto),
              esperado.productos.editarYEliminar,
              `editar el producto, para ${rol}`,
            );
            await afirmar(
              accesos.eliminarProducto(producto),
              esperado.productos.editarYEliminar,
              `eliminar el producto, para ${rol}`,
            );
          });

          await test.step("Pestañas de Configuración", async () => {
            await accesos.irAConfiguracion();

            for (const [clave, visible] of Object.entries(esperado.pestanas)) {
              await afirmar(
                accesos.pestanas[clave],
                visible,
                `pestaña "${clave}" para ${rol}`,
              );
            }
          });

          if (esperado.usuarios === null) {
            // Sin `member:read` la pestaña no existe, asi que no hay seccion
            // que recorrer. Que la pestaña falte ya se afirmo arriba.
            return;
          }

          await test.step("Sección Usuarios", async () => {
            await accesos.irAConfiguracion("usuarios");

            await afirmar(
              accesos.usuarios.invitar,
              esperado.usuarios.invitar,
              `"invitar" para ${rol}`,
            );
            await afirmar(
              accesos.usuarios.soloLectura,
              esperado.usuarios.soloLectura,
              `el aviso de solo lectura, para ${rol}`,
            );

            // La fila del OTRO, no la propia: los controles de rol nunca
            // aparecen en la fila de uno mismo.
            const { miembros } = await leerMiembros(api);
            const fila = miembroPorCorreo(miembros, otro.email);

            await expect(accesos.filaDeMiembro(otro.email)).toBeVisible();
            await afirmar(
              accesos.rolDeMiembro(fila.id),
              esperado.usuarios.cambiarYQuitarAOtro,
              `cambiarle el rol a otro, para ${rol}`,
            );
            await afirmar(
              accesos.quitarMiembro(fila.id),
              esperado.usuarios.cambiarYQuitarAOtro,
              `quitar a otro, para ${rol}`,
            );
          });
        } finally {
          await context?.close();
        }
      });
    }
  });

  test.describe("El correo del equipo en el historial", () => {
    /**
     * El criterio «un usuario no accede a informacion fuera de su rol» en su
     * forma mas concreta: el historial no puede ser la puerta de atras para
     * juntar los correos del equipo.
     *
     * Se afirma sobre el payload de CADA navegador y no sobre la pantalla. El
     * porque esta en `soporte/historial.js`: por pantalla sale
     * `nombre || correo`, y como el andamiaje siempre pone nombre, el correo no
     * se renderiza nunca. Una asercion de pantalla pasaria igual si el backend
     * filtrara mal.
     *
     * Lo que agrega sobre `Backend/tests/controlAcceso.test.js`, que ya verifica
     * el recorte: el rol sale de la cookie que emitio el sign-up, no de un
     * pedido armado a mano, y la respuesta cruza Nginx. Si el rol se perdiera
     * en el proxy, el supertest seguiria verde y esto caeria.
     */
    test("el empleado no recibe los correos; el gerente y el propietario sí", async ({
      page,
      api,
      playwright,
      browser,
    }) => {
      const producto = await crearProductoViaApi(api);
      const ubicaciones = await leerUbicaciones(api);
      const principal = ubicacionPorNombre(ubicaciones, UBICACION_POR_DEFECTO);

      // Lo registra el propietario: su correo es el que el empleado no tiene
      // que poder ver.
      // «compra» y no «ajuste» ni «merma» a proposito: esos dos exigen motivo
      // desde HU-15, y acá el movimiento es andamiaje, no el sujeto.
      await registrarMovimientoViaApi(api, {
        productoId: producto.id,
        tipo: "compra",
        cantidad: 5,
        ubicacionId: principal.id,
      });

      const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
      const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });

      await test.step("el propietario sí ve el correo", async () => {
        const historial = new Historial(page);
        const { movimientos } = await historial.irYLeerPayload();

        expect(movimientos[0].usuario).toHaveProperty("correo");
      });

      for (const [rol, persona] of [
        ["empleado", empleado],
        ["gerente", gerente],
      ]) {
        await test.step(`el ${rol}`, async () => {
          const { context, page: pagina } = await abrirComo(
            browser,
            persona.storageState,
          );

          try {
            const historial = new Historial(pagina);
            const { movimientos } = await historial.irYLeerPayload();

            expect(
              movimientos.length,
              "el historial tendría que tener el movimiento del propietario",
            ).toBeGreaterThan(0);

            if (rol === "empleado") {
              // Ausente, no vacio: el backend omite la clave entera.
              expect(movimientos[0].usuario).not.toHaveProperty("correo");

              // Y tampoco se filtro por ningun otro lado de la pantalla.
              await expect(pagina.getByText(persona.email)).toHaveCount(0);
            } else {
              expect(movimientos[0].usuario).toHaveProperty("correo");
            }

            // El nombre sale siempre: sin el, el historial no diria quien hizo
            // que. El recorte es del correo, no de la autoria.
            expect(movimientos[0].usuario.nombre).toBeTruthy();
          } finally {
            await context.close();
          }
        });
      }
    });
  });

  test.describe("Rutas con guarda, escribiendo la URL a mano", () => {
    /**
     * Las unicas dos rutas que hoy pueden mostrar el cartel: las dos piden
     * `producto:create`, que el empleado no tiene.
     *
     * `/movimientos/nuevo` y `/transferencias` tambien tienen guarda, pero los
     * tres roles tienen `movimiento:create` y `transferencia:create`, asi que
     * hoy no hay rol que pueda verlas bloqueadas. Se cubren abajo del lado
     * positivo, que es el riesgo real: que un cambio de permisos deje a alguien
     * afuera de donde si tiene que entrar.
     */
    for (const ruta of ["/productos/importar", "/productos/escanear"]) {
      test(`el empleado que escribe ${ruta} ve el cartel, no una pantalla rota`, async ({
        api,
        playwright,
        browser,
      }) => {
        const empleado = await sumarMiembro(playwright, api, {
          rol: "empleado",
        });
        const { context, page: pagina } = await abrirComo(
          browser,
          empleado.storageState,
        );

        try {
          const accesos = new Accesos(pagina);
          await pagina.goto(ruta);

          await expect(accesos.sinPermiso).toBeVisible();

          // Lo que distingue "bloqueado" de "roto" y de "redirect silencioso":
          // sigue en la ruta que pidio, con una salida ofrecida, y no es un
          // error del sistema ni una sesion vencida.
          await expect(pagina).toHaveURL(new RegExp(`${ruta}$`));
          await expect(
            pagina.getByRole("link", { name: "Volver al inicio →" }),
          ).toBeVisible();
          await expect(accesos.avisoSesion).toHaveCount(0);
          await expect(accesos.avisoGeneral).toHaveCount(0);
        } finally {
          await context.close();
        }
      });
    }

    /**
     * Las pestañas de Configuracion no tienen guarda de ruta, asi que su
     * «escribir la URL a mano» es otro mecanismo: `activa` se resuelve contra
     * las pestañas VISIBLES, no contra la que pide la query.
     *
     * Vale cubrirlo porque es el caso que HU-32 cambio de forma: antes la
     * seccion se abria y el 403 del backend explicaba por que no; ahora cae en
     * Perfil. Lo que hay que afirmar es que cae en una pestaña que SI puede
     * ver, y no en una pantalla vacia ni en una seccion a medias.
     */
    for (const seccion of ["usuarios", "auditoria"]) {
      test(`el empleado que escribe ?seccion=${seccion} cae en una pestaña que sí puede ver`, async ({
        api,
        playwright,
        browser,
      }) => {
        const empleado = await sumarMiembro(playwright, api, {
          rol: "empleado",
        });
        const { context, page: pagina } = await abrirComo(
          browser,
          empleado.storageState,
        );

        try {
          const accesos = new Accesos(pagina);
          const configuracion = new Configuracion(pagina);
          await accesos.irAConfiguracion(seccion);

          await expect(accesos.pestanas[seccion]).toHaveCount(0);

          // Cae en Perfil, y Perfil queda realmente seleccionada y con su
          // contenido: sin la segunda parte, «no se ve la pestaña prohibida»
          // se cumpliria igual con la pantalla en blanco.
          await expect(accesos.pestanas.perfil).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await expect(configuracion.perfil.nombre).toBeVisible();

          // Y no se lo acusa de nada: no hubo pedido que diera 403.
          await expect(accesos.avisoPermiso).toHaveCount(0);
          await expect(accesos.sinPermiso).toHaveCount(0);
        } finally {
          await context.close();
        }
      });
    }

    /**
     * HU-32 separo `transferencia:create` de `movimiento:create`. La parte
     * positiva ya la cubre `roles.spec.js` para el empleado; lo que falta es
     * confirmar que la separacion no dejo a NINGUN rol afuera, que es el modo
     * en que ese cambio podia salir mal.
     *
     * Un test por rol y no los tres en uno: los tres juntos daban un test de
     * tres altas por API y seis navegaciones, que no entraba en el timeout.
     * Partirlo es mejor que estirarlo — asi cada caso corre en paralelo y la
     * falla dice cual rol quedo afuera, en vez de dejarlo dentro de un step.
     */
    for (const rol of ROLES) {
      test(`el ${rol} entra a /transferencias y a /movimientos/nuevo`, async ({
        page,
        api,
        playwright,
        browser,
      }) => {
        await armarEscenario(api);

        const propio = rol === "propietario";
        const persona = propio
          ? null
          : await sumarMiembro(playwright, api, { rol });
        const { context, page: pagina } = propio
          ? { context: null, page }
          : await abrirComo(browser, persona.storageState);

        try {
          const accesos = new Accesos(pagina);

          for (const ruta of ["/transferencias", "/movimientos/nuevo"]) {
            await pagina.goto(ruta);

            // El `<h1>` de cada pantalla es la prueba de que la guarda dejo
            // pasar, y no es decorativo: el cartel de `sin-permiso` no tiene
            // `<h1>` —es un `<p>` en negrita—, asi que si la guarda frenara,
            // esto caeria. Afirmar solo la ausencia del cartel se cumpliria
            // igual mientras la ruta todavia muestra «Cargando…».
            await expect(pagina.getByRole("heading", { level: 1 })).toBeVisible();
            await expect(
              accesos.sinPermiso,
              `${rol} tendría que poder entrar a ${ruta}`,
            ).toHaveCount(0);
          }
        } finally {
          await context?.close();
        }
      });
    }
  });

  test.describe("Cambio de rol en caliente", () => {
    /**
     * El caso que pide el criterio «cada endpoint valida el rol»: que la
     * pantalla ya abierta no siga siendo una puerta despues de que le bajaron
     * el rol a la persona.
     *
     * No hay un solo `waitForTimeout` ni un retry. Cada paso espera un efecto
     * observable, y el orden es determinista: el rol se cambia por API DESPUES
     * de que la pantalla cargo, y la accion se dispara DESPUES del cambio.
     *
     * Si este test sale flaky justo en el cambio de rol, no se tapa con un
     * retry: es candidato a regresion de los bugs de carrera que HU-32 arreglo
     * con el contador de generacion, y hay que avisarlo.
     */
    test("bajar al gerente a empleado corta la acción sin desloguearlo", async ({
      api,
      playwright,
      browser,
    }) => {
      const producto = await armarEscenario(api);
      const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });

      const { miembros } = await leerMiembros(api);
      const fila = miembroPorCorreo(miembros, gerente.email);

      const { context, page: pagina } = await abrirComo(
        browser,
        gerente.storageState,
      );

      try {
        const accesos = new Accesos(pagina);
        const catalogo = new Catalogo(pagina);

        // 1. Con el rol que todavia tiene, el boton esta.
        await accesos.irAProductos(producto);
        await expect(accesos.eliminarProducto(producto)).toBeVisible();

        // 2. El propietario lo baja, sin que la pantalla se recargue.
        await cambiarRolViaApi(api, fila.id, "empleado");

        // 3. Repite la accion que hasta hace un segundo podia hacer.
        await accesos.eliminarProducto(producto).click();
        await catalogo
          .confirmacion(producto)
          .getByRole("button", { name: "Sí, eliminar" })
          .click();

        // 4. El backend corta con 403 y la pantalla lo cuenta como lo que es.
        await expect(accesos.avisoPermiso).toBeVisible();

        // 5. NO lo desloguea. Es el reflejo que HU-32 vino a corregir: un 403
        //    no es una sesion vencida.
        await expect(accesos.avisoSesion).toHaveCount(0);
        await expect(pagina).toHaveURL(/\/productos$/);

        // 6. La pantalla se reacomoda SIN recargar: el aviso de permiso relee
        //    los permisos al montarse.
        //
        //    Estos dos van primero, y son los que de verdad prueban el punto,
        //    porque viven en la pantalla y no en la fila: el aviso de solo
        //    lectura aparece y el alta manual desaparece.
        await expect(accesos.productos.soloLectura).toBeVisible();
        await expect(accesos.productos.nuevoManual).toHaveCount(0);

        // 7. Recien ahora los botones de la fila, y hay que cerrar la
        //    confirmacion antes de mirar.
        //
        //    `confirmando` es estado local de la fila y el 403 no lo limpia,
        //    asi que la fila sigue mostrando «¿Eliminar …?». Mientras ese
        //    cartel este abierto, el boton de eliminar no esta en el DOM
        //    porque la confirmacion lo reemplazo —no porque se haya perdido el
        //    permiso—, y afirmar su ausencia ahi pasaria por la razon
        //    equivocada. Cancelar devuelve la fila a su forma normal, que es
        //    donde la pregunta «estan los botones?» significa algo.
        await catalogo
          .confirmacion(producto)
          .getByRole("button", { name: "Cancelar" })
          .click();

        await expect(catalogo.fila(producto)).toBeVisible();
        await expect(accesos.eliminarProducto(producto)).toHaveCount(0);
        await expect(accesos.editarProducto(producto)).toHaveCount(0);

        // 8. Y «Ver stock» sigue estando: consultar lo puede hacer cualquier
        //    rol, asi que lo que se perdio es la edicion, no la fila.
        await expect(catalogo.linkVerStock(producto)).toBeVisible();
      } finally {
        await context.close();
      }
    });
  });

  test.describe("Sesión vencida", () => {
    /**
     * El otro lado del par: un 401 SI tiene que llevar al login, y es
     * justamente lo que un 403 no tiene que hacer.
     *
     * La cookie se borra del contexto ya cargado y NO se navega. Eso importa:
     * si la pagina se recargara, `useAuth` resolveria `!autenticado` y
     * `RutaProtegida` redirigiria al login antes de que ninguna llamada diera
     * 401 — se estaria probando el redirect de la ruta, no la clasificacion del
     * error, que es el sujeto.
     *
     * Limitacion asumida: esto prueba «sin cookie», no «cookie vencida». Para
     * el backend son el mismo caso —las dos dan 401 «No hay sesion activa»—, y
     * la alternativa (borrar la fila de `session` en Postgres) pediria traer un
     * pool de `pg` a la suite e2e, que hoy no lo tiene, para llegar al mismo
     * 401.
     */
    test("una acción protegida sin sesión muestra el aviso y ofrece volver a entrar", async ({
      api,
      playwright,
      browser,
    }) => {
      const producto = await armarEscenario(api);
      const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });

      const { context, page: pagina } = await abrirComo(
        browser,
        gerente.storageState,
      );

      try {
        const accesos = new Accesos(pagina);
        const catalogo = new Catalogo(pagina);

        await accesos.irAProductos(producto);
        await expect(accesos.eliminarProducto(producto)).toBeVisible();

        await context.clearCookies();

        await accesos.eliminarProducto(producto).click();
        await catalogo
          .confirmacion(producto)
          .getByRole("button", { name: "Sí, eliminar" })
          .click();

        await expect(accesos.avisoSesion).toBeVisible();
        await expect(accesos.volverAEntrar).toHaveAttribute("href", "/login");

        // Y no se confunde con el otro caso: una sesion vencida no es falta de
        // permiso.
        await expect(accesos.avisoPermiso).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
});
