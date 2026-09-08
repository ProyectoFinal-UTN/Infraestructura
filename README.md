# Infraestructura — Centralización y Optimización de la Gestión Comercial

Orquestación del stack completo: Nginx como reverse proxy, Docker Compose levantando Frontend + Backend + Nginx juntos, y (a futuro) tests de integración end-to-end sobre el sistema completo.

## Para qué sirve este repo

Los repos `Frontend` y `Backend` funcionan cada uno de forma independiente en desarrollo (`npm run dev`, sin Docker). Este repo une a los tres en un solo stack local, útil para probar la integración completa y como evidencia de la arquitectura de contenedores. **La producción real no usa este Nginx**: el despliegue final es Backend en Render y Frontend en Vercel, cada uno como servicio independiente con su propio dominio y TLS gestionado por la plataforma (ver Informe de Arquitectura y Despliegue).

**No contiene código de la aplicación** — solo configuración de infraestructura y (eventualmente) tests.

## Requisitos previos

- **Docker Desktop** instalado y corriendo (con backend WSL2 si es Windows).
- Los repos `Frontend`, `Backend` e `Infraestructura` clonados **como carpetas hermanas**, al mismo nivel:

```
Desarrollo/
├── Backend/
├── Frontend/
└── Infraestructura/   ← este repo
```

- Un archivo `.env` real en `Backend/` con `DATABASE_URL` y demás variables completas (ver el README de `Backend`). Este repo **no tiene su propio `.env`** — usa el del backend directamente.

## Levantar el stack completo

Desde la raíz de este repo:

```bash
docker compose up --build
```

- App completa disponible en `http://localhost` (puerto 80)
- `http://localhost/` → sirve el Frontend
- `http://localhost/api/...` → redirige al Backend
- `http://localhost/api-docs/` → redirige al Swagger UI del Backend

Para detener todo:

```bash
docker compose down
```

Para reconstruir un solo servicio después de un cambio (por ejemplo, tras un pull de `Backend`):

```bash
docker compose up --build backend
```

## HTTPS local (para probar la cámara desde el celular — HU-10)

Los navegadores bloquean el acceso a la cámara (`getUserMedia`) fuera de un "contexto seguro": HTTPS, con la única excepción de `http://localhost`. Eso alcanza para probar en la misma PC, pero **no** para un celular real conectándose por la IP de LAN de la PC (ej. `http://192.168.1.23`) — ahí el navegador bloquea la cámara aunque el resto de la app funcione bien.

`docker compose up --build` (sin nada más) sigue funcionando exactamente igual que siempre, solo en HTTP — este paso es **opcional**, hace falta únicamente para probar el escaneo de código de barras en un celular.

1. Instalar `mkcert` una vez por PC (`choco install mkcert` en Windows, `brew install mkcert` en Mac) y correr `mkcert -install` para confiar el CA raíz local.
2. Averiguar la IP de LAN de la PC (`ipconfig` en Windows, `ifconfig`/`ip a` en Mac/Linux — buscar la IP de la red Wi-Fi, ej. `192.168.1.23`).
3. Generar el certificado para esa IP, dentro de este repo:
   ```bash
   mkdir certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem <IP-LAN> localhost 127.0.0.1
   ```
   `certs/` está en `.gitignore` — el cert es local a cada developer/red, nunca se commitea.
4. (Opcional pero recomendado) crear un `.env` en este repo con la misma IP, para que Better Auth acepte el origin:
   ```
   HTTPS_LOCAL_ORIGIN=https://<IP-LAN>
   ```
5. Levantar el stack con el override de HTTPS sumado al de siempre:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.https.yml up --build
   ```
6. Confiar el CA raíz de mkcert en el celular — es un paso único por dispositivo. Hay que transferirle el archivo `rootCA.pem` (mkcert indica su ubicación con `mkcert -CAROOT`) e instalarlo como perfil de confianza:
   - **Mac**: AirDrop directo al celular.
   - **Windows** (sin AirDrop): la forma más simple es copiarlo dentro del contenedor de `frontend`, que ya sirve HTTP en el puerto 80 sin necesitar certificado — `curl` desde el celular no hace falta, alcanza con Safari:
     ```bash
     docker cp "$(mkcert -CAROOT)/rootCA.pem" infraestructura-frontend-1:/usr/share/nginx/html/rootCA.pem
     ```
     Después, desde el celular, en Safari: `http://<IP-LAN>/rootCA.pem` → "Permitir" para descargar el perfil → Ajustes → tocar el banner "Perfil descargado" (o Ajustes > General > VPN y administración de dispositivos) → **Instalar** (pide el código de bloqueo) → confirmar el aviso de "Perfil no verificado" con **Instalar** de nuevo → **Listo**. Ese archivo es público (no es sensible, es el certificado raíz, no la clave privada), así que no importa si queda servido un rato en HTTP plano.
   - Con el perfil instalado, todavía falta activar la confianza total: Ajustes > General > Información > **Config. certificados de confianza**, y activar el switch de "mkcert ..." bajo "Certificados raíz de confianza completa". Sin este paso, iOS instala el certificado pero Safari lo sigue tratando como no confiable.
7. Desde el celular, en la **misma red Wi-Fi** que la PC, entrar a `https://<IP-LAN>`.

**Alternativa sin instalar nada**, si el proyecto ya tiene Vercel conectado: probar directo contra el preview URL de la PR del Frontend, que ya tiene HTTPS real de Vercel sin configurar nada acá. mkcert queda para cuando hace falta todo el stack local (Backend + Nginx incluidos), no solo el Frontend.

### Si el celular no encuentra el servidor (Docker Desktop + WSL2)

Con Docker Desktop sobre WSL2, es común que `http://<IP-LAN>` funcione perfecto desde la propia PC (incluso `Test-NetConnection` da OK) pero **no conteste desde otro dispositivo** — el puerto está escuchando en `0.0.0.0` y el firewall lo permite, pero WSL2 en modo NAT (el default) no reenvía bien las conexiones que llegan desde fuera de la PC. Vite no tiene este problema porque corre como proceso nativo de Windows, no a través de WSL2.

Arreglo, una sola vez por PC:

1. Crear (o editar) `%UserProfile%\.wslconfig` con:
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
2. Reiniciar WSL2 desde una terminal cualquiera: `wsl --shutdown` (esto corta cualquier otra sesión de WSL2 que tengas abierta, no solo Docker).
3. Esperar a que Docker Desktop vuelva a levantar el motor (unos segundos) y volver a correr `docker compose ... up --build`.

Con eso, `com.docker.backend.exe` pasa a escuchar de forma que sí acepta conexiones entrantes desde otros dispositivos de la LAN. Confirmado funcionando con un iPhone real.

**Además del firewall para mkcert/Nginx**, si vas a bajar `rootCA.pem` desde el celular (paso 6), necesitás permitir explícitamente el puerto por el que lo serví (80 y 443) si Windows no lo dejó pasar solo — en PowerShell **como administrador**:
```powershell
New-NetFirewallRule -DisplayName "Docker HTTP-HTTPS LAN" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Profile Any
```

## Estructura

```
nginx/
├── Dockerfile           # empaqueta Nginx con la config de este repo
├── nginx.conf           # config por defecto, HTTP en :80
├── nginx.https.conf     # variante opt-in con HTTPS en :443 (ver arriba)
└── locations.conf       # reglas de enrutamiento (/ , /api/, /api-docs/), compartidas por ambas
tests/
├── global-setup.js       # chequeos previos: ramas de Backend/Frontend y stack arriba
├── global-teardown.js    # borra de la base lo que creó la corrida
├── soporte/              # andamiaje compartido: fixtures, datos y altas por API
├── e2e/                  # flujos de usuario por la interfaz (+ soporte/: page objects)
└── api/                  # lo que no se ve por pantalla (+ soporte/: lectura de la base)
playwright.config.js      # dos proyectos: `chromium` (e2e) y `api` (sin navegador)
docker-compose.yml        # orquesta nginx + frontend + backend (uso normal)
docker-compose.https.yml  # override opcional para sumar HTTPS local
```

## Cómo funciona el enrutamiento (Nginx)

| Ruta | Va a | Sirve |
|---|---|---|
| `/` | contenedor `frontend` | Archivos estáticos del build de React |
| `/api/*` | contenedor `backend` | API REST (Express) |
| `/api-docs/*` | contenedor `backend` | Documentación Swagger |

Los contenedores `frontend` y `backend` **no están expuestos directamente** al exterior — solo son alcanzables entre sí dentro de la red interna de Docker Compose. Nginx es el único punto de entrada público.

## Tests E2E

Acá viven los tests que necesitan **todo el stack levantado** para tener sentido: simulan a un usuario real contra `http://localhost`, con el build de producción del Frontend servido por Nginx hablando con el Backend y con la base real. El framework es **Playwright**.

Es una capa distinta de las otras dos, no un reemplazo:

| Nivel | Dónde vive | Runner |
|---|---|---|
| Unitario de componentes | `Frontend/src/**/*.test.jsx` | Vitest |
| Unitario de lógica | `Backend/tests/*.service.test.js` | Jest |
| Integración de API (sin UI) | `Backend/tests/*.test.js` | Jest + supertest |
| **E2E sobre el stack completo** | **`Infraestructura/tests/e2e/`** | **Playwright** |
| **API sobre el stack completo** | **`Infraestructura/tests/api/`** | **Playwright** |

Los tests de `tests/e2e/` cubren **flujos de usuario por la interfaz**. No repiten las validaciones, los códigos de estado ni el multi-tenant que ya cubren los tests de integración del Backend: la API se usa como andamiaje (armar el escenario de un test) y para verificar lo que la pantalla no muestra.

Los de `tests/api/` son la excepción, y son pocos a propósito: van ahí las propiedades que **no se ven en ninguna pantalla** y que hay que verificar contra la API o contra el enrutamiento crudo de Nginx, sin que un navegador aporte nada. Corren en su propio proyecto de Playwright (`--project=api`), sin navegador.

### Correrlos

Requisito previo: **el stack tiene que estar levantado**, y `Backend` y `Frontend` tienen que estar en la rama que se quiere probar (normalmente `dev`, que es lo que exige el chequeo previo). `docker-compose.yml` construye con `context: ../Backend` y `../Frontend`, así que la imagen sale de lo que esté checkouteado en la carpeta hermana — el checkout es lo único que define contra qué código se testea.

```bash
git -C ../Backend  checkout dev && git -C ../Backend  pull origin dev
git -C ../Frontend checkout dev && git -C ../Frontend pull origin dev
docker compose up --build          # dejar corriendo en otra terminal
```

Y en este repo, una vez por máquina:

```bash
npm install
npx playwright install chromium
```

Después:

```bash
npm run test:e2e            # corre todo (los dos proyectos)
npm run test:e2e:api        # solo los de tests/api/, sin navegador
npm run test:e2e:ui         # modo interactivo, para depurar
npm run test:e2e:headed     # con el navegador a la vista
npm run test:e2e:report     # abre el reporte HTML de la última corrida

npm run test:e2e -- movimientos      # filtra por ruta: acá, los dos specs de HU-13
npm run test:e2e -- -g "merma"       # filtra por nombre de test
```

Antes de correr nada, `tests/global-setup.js` verifica dos cosas y aborta con un mensaje claro si alguna falla: que `Backend` y `Frontend` estén en `dev` (una feature branch olvidada daría una corrida verde que no prueba lo que dice probar), y que el stack responda en `http://localhost/health` — esto último suple el `healthcheck` pendiente del que habla el Troubleshooting.

Variables de entorno opcionales:

| Variable | Para qué |
|---|---|
| `E2E_CHANNEL=chrome` | Usa el Chrome (o `msedge`) ya instalado en vez del Chromium de Playwright. Sirve cuando bajar esos 200 MB no es viable, con la salvedad de que se testea contra una versión del navegador que no controlamos. |
| `E2E_RAMA_ESPERADA` | Cambia la rama que se exige en `Backend`/`Frontend`. Por defecto `dev`. |
| `E2E_BASE_URL` | Apunta la suite a otra URL. Por defecto `http://localhost`. |

Los workers están fijados en 2: el cuello de botella no es la CPU sino Neon, que es remota y compartida, y por encima de eso las consultas de sesión empiezan a cortar por timeout.

### Datos de prueba

Cada test registra **su propio comercio** (`test-e2e-...@test.local`), así que arranca con el catálogo vacío y no puede pisar lo que hizo otro: los tests corren sueltos, en cualquier orden y en paralelo. Al terminar la corrida, `tests/global-teardown.js` borra de la base todo lo que se creó, identificándolo por el sufijo de esa corrida —el mismo criterio que el `afterAll` de `Backend/tests/productos.test.js`— usando la `DATABASE_URL` de `../Backend/.env`.

**Entre tests no se limpia nada, y es a propósito**: el aislamiento sale de no compartir datos, no de borrarlos. Es además lo único coherente con el modelo, porque `movimiento` es un libro append-only —no hay DELETE por diseño— y borrar filas para dejar el terreno limpio contradiría justo el invariante que HU-13 viene a probar. El orden del teardown (primero `comercio`, que se lleva todo en cascada; después el `user`) es obligatorio por el `onDelete: restrict` de `movimiento.usuario_id`.

El andamiaje compartido por las dos suites vive en `tests/soporte/`: el fixture del comercio autenticado, los generadores de datos y las altas por API. Los *page objects* —los selectores de cada pantalla— quedan en `tests/e2e/soporte/`.

### Cobertura actual

- `tests/e2e/registro.spec.js` — HU-1: registro real por el formulario de `/registro` (no por API, a diferencia del resto de la suite), la sesión queda iniciada tras el alta, y desde ahí se navega por un link real hasta `/productos` y se ve el catálogo vacío. Es el único spec que ejercita el camino completo de un usuario que nunca tuvo sesión a través de los tres contenedores.
- `tests/e2e/productos.spec.js` — HU-9 (SCRUM-21 / SCRUM-91): alta con datos válidos, rechazo de datos incompletos o inválidos, edición, y baja lógica con confirmación previa.
- `tests/e2e/movimientos.spec.js` — HU-13 (SCRUM-25 / SCRUM-94): un movimiento de cada tipo (compra, venta, merma y ajuste en los dos sentidos) con el stock resultante verificado contra `GET /api/productos/:id`; rechazo de la salida que dejaría el stock en negativo; el flujo en 3 pasos desde el inicio (RNF1); y el caso de ubicación —con una sola no se pide el campo, con más de una es obligatoria y el saldo cae en la elegida—.
- `tests/api/enrutamiento.spec.js` — enrutamiento de Nginx contra el stack real (ver `nginx/locations.conf`): `/` sirve el HTML del Frontend, `/health` devuelve el estado del Backend (además funciona como smoke test reportado, no solo como gate de `global-setup.js`), `/api/...` sin sesión devuelve 401 con el path intacto (confirma que no está el bug de la barra final en `proxy_pass` que comenta `nginx.conf`), y `/api-docs/` sirve el Swagger UI.
- `tests/api/atomicidad-movimientos.spec.js` — HU-13, criterio de rollback: que un rechazo no deje el sistema a medias. Es lo único que no se puede ver por pantalla, así que va contra la API y lee `movimiento` y `stock` directo de la base.

Sobre este último, para que nadie lo lea de más: los dos guardas del backend (stock insuficiente y desborde del `integer`) corren **antes** del INSERT del movimiento, así que por HTTP no hay forma de forzar un fallo *después* de insertar. Lo que se verifica no es el `ROLLBACK` de Postgres sino su consecuencia observable —ningún rechazo deja rastro, el saldo cacheado nunca se despega del libro—, atravesando Nginx y el contenedor real. `Backend/tests/movimientos.test.js` ya prueba la lógica en proceso; acá se comprueba que la propiedad sobrevive al stack completo, que es la condición de la promoción `dev` → `main`.

- `tests/e2e/escanear.spec.js` — HU-10: escanea el código de barras de un producto ya cargado y entra a su detalle desde el resultado. Usa una cámara falsa de verdad, no un mock de `getUserMedia`: `tests/e2e/soporte/camara-falsa.js` arma un archivo Y4M con un EAN-13 válido (dígito de control incluido, si no zxing lo descarta como ilegible) y Chromium lo sirve como si fuera una webcam vía `--use-fake-device-for-media-stream` + `--use-file-for-fake-video-capture`. Así se prueba la cadena real: cámara → `@zxing/browser` decodificando frames del `<video>` → `GET /api/productos/codigo/:codigoBarras`. El escenario es el de "producto ya existe": es el único de los dos que no depende de Open Food Facts (API externa), así que no se vuelve flaky por un servicio de terceros. La sugerencia de Open Food Facts para códigos nuevos queda sin cubrir por esta suite — es un problema de datos de terceros, no del stack propio.

## Flujo de trabajo con Git

- **`main`**: versión estable, la que se muestra en cada Sprint Review. Protegida — nadie pushea directo.
- **`dev`**: rama de integración del Sprint en curso. También protegida — nadie pushea directo.
- Cada tarea de infraestructura se desarrolla en su propia rama, creada desde `dev`:

```bash
  git checkout dev
  git pull origin dev
  git checkout -b chore/nombre-descriptivo
```

- Al terminar, se abre un Pull Request hacia `dev` (no hacia `main`), asignando a otro integrante como reviewer.
- Este repo tiene un rol particular en la promoción `dev` → `main` de **los tres repos**: es donde la persona a cargo de testing corre los tests de integración sobre el estado combinado de `dev` en Frontend/Backend/Infraestructura antes de aprobar que se promueva a `main`.
- Después de mergear una rama, borrarla.
- Commits descriptivos, no genéricos.

## Troubleshooting

- **`docker compose up --build` falla en el build de `frontend` o `backend`**: confirmar que esos repos ya tienen su propio `Dockerfile` en la raíz, y que están clonados como carpetas hermanas de este repo (no anidadas una dentro de otra).
- **El backend no arranca / no conecta a la base**: confirmar que existe `Backend/.env` con `DATABASE_URL` real. Este repo no crea ese archivo, solo lo referencia.
- **`depends_on` no espera a que el backend esté realmente listo**: es una limitación conocida de Docker Compose — `depends_on` solo espera a que el contenedor arranque, no a que el servicio esté sano. Si aparecen errores intermitentes de conexión al levantar todo por primera vez, reintentar `docker compose up` suele resolverlo; un `healthcheck` es la solución definitiva, pendiente de agregar.
- **Cambios en el código de `Backend` o `Frontend` no se reflejan**: Docker usa la imagen construida en el último build, no el código actual. Correr `docker compose up --build` de nuevo (no solo `docker compose up`) para reconstruir con los cambios.