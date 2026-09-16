# Autorización registro biométrico

Aplicación interna para que los trabajadores consulten sus datos, lean y acepten la **Autorización registro biométrico para ingreso a instalaciones** (formato oficial de CEDENAR S.A. E.S.P.), firmen sobre pantalla y descarguen una constancia PDF. El documento y el PDF replican el formato oficial: texto de autorización con nombre, cédula y ciudad del trabajador, dirección de la empresa, correo `consulta.protecciondatospersonales@cedenar.com.co`, línea de atención 602 7244321, y cierre con Firma / Nombre / C.C. No. No captura ni almacena huellas, rostros, plantillas ni muestras biométricas.

## Requisitos

- Node.js 18 o superior.
- npm.
- El archivo `PLANTA PERSONAL - TERMNO INDEFINIDO Y FIJO.xlsx` en la raíz del proyecto para la carga inicial.

## Instalación y ejecución

```bash
npm install
copy .env.example .env
npm start
```

Abra `http://localhost:3000`. El formulario público toma automáticamente el Excel de la raíz. Al iniciar por primera vez crea `data/biometrico.sqlite` y carga las filas de empleados que tengan `CEDULA`, `NOMBRE`, `CARGO` y `AREA`. Las filas de totales, encabezados y filas sin cédula se ignoran. Una nueva importación no reemplaza los datos de una autorización ya registrada.

Para desarrollo con recarga automática:

```bash
npm run dev
```

## Variables de entorno

- `SESSION_SECRET`: secreto largo y aleatorio para las cookies de sesión.
- `ADMIN_PASSWORD_HASH`: hash bcrypt de la contraseña administrativa. Nunca se guarda la contraseña en el código.
- `PUBLIC_URL`: URL que quedará codificada en el QR.
- `QR_PUBLIC_TOKEN`: token largo para proteger el formulario público. Si está vacío, el formulario funciona sin token solo para desarrollo local.
- `RAZON_SOCIAL`, `NIT`, `CORREO_PROTECCION_DATOS`, `RESPONSABLE_TRATAMIENTO`: datos institucionales configurables.
- `VERSION_AUTORIZACION`: versión que se almacena junto al consentimiento.
- `POLITICA_PRIVACIDAD_URL`: enlace a la política institucional.
- `MAX_FILE_SIZE_MB`: tamaño máximo de importación.

Para generar un hash bcrypt localmente, con las dependencias instaladas:

```bash
node -e "console.log(require('bcryptjs').hashSync('CAMBIA_ESTA_CLAVE', 12))"
```

Pegue el resultado en `ADMIN_PASSWORD_HASH` del `.env`. Use HTTPS y `NODE_ENV=production` en despliegues reales; las cookies pasan a ser `Secure`.

## Panel administrativo

Entre en `http://localhost:3000/admin` e inicie sesión. El panel permite:

- Ver total, autorizados, pendientes y porcentaje de avance.
- Buscar por cédula, nombre o cargo y filtrar por estado o dependencia.
- Crear, editar y eliminar trabajadores.
- Importar CSV, XLSX o XLS con columnas `Cedula`/`CEDULA`, `Nombre`/`NOMBRE`, `Cargo`/`CARGO`, `Dependencia` o `Area`/`AREA`.
- Descargar cada PDF, generar un QR autorizado y descargar un ZIP con PDFs y CSV de control.

## Flujo de validación manual

1. Configure `.env`, arranque la aplicación y abra el QR o la URL pública.
2. Consulte una cédula que exista en el Excel. Deben aparecer nombre, cargo, área, cédula y fecha.
3. Verifique que una cédula inexistente muestre: `Empleado no encontrado. Verifica la cédula e inténtalo nuevamente.`
4. Intente guardar sin marcar la casilla y luego sin firma: ambas acciones deben ser rechazadas.
5. Dibuje una firma, marque la casilla y guarde. Debe aparecer la confirmación `Tu autorización sí quedó guardada`, un PDF descargable y el estado `AUTORIZADO` en `/admin`.
6. Consulte de nuevo la misma cédula: el sistema debe impedir una segunda autorización.
7. Abra `/admin` sin sesión: solo debe aparecer el inicio de sesión y las APIs administrativas deben responder 401.
8. Importe una copia CSV/XLSX del listado. Compruebe que se cargan todas las filas de empleados y que una autorización existente no vuelve a pendiente.
9. Descargue el ZIP y confirme que contiene `control_autorizaciones.csv` y los PDFs disponibles.

## Consideraciones legales

Los datos biométricos son datos personales sensibles. Esta plataforma registra el consentimiento, no sustituye el sistema biométrico institucional y no almacena muestras biométricas reales. El texto debe ser revisado y aprobado antes de uso por el área jurídica y el oficial de protección de datos de la empresa. Configure el responsable, correo, política y finalidades conforme a la realidad institucional y a la política colombiana aplicable.
