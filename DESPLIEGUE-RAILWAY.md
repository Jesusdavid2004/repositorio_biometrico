# Despliegue en Railway

## 1. Subir el código a GitHub

```bash
git init
git add .
git commit -m "Sistema de autorización registro biométrico CEDENAR"
git remote add origin https://github.com/TU_USUARIO/autorizacion-biometrica.git
git push -u origin main
```

El archivo `.env` está en `.gitignore`, así que tus claves nunca se suben al repositorio.

## 2. Crear el proyecto en Railway

1. Entra a https://railway.app e inicia sesión.
2. **New Project → Deploy from GitHub repo** y selecciona el repositorio.
3. Railway detecta Node.js automáticamente, instala con `npm install` y arranca con `npm start` (o el `Procfile`).

## 3. Variables de entorno en Railway

En el proyecto → **Variables**, agrega:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | `e0418a6e67ea11dc316b84037524360770a6f283429037c65d494bfcc141fdd3d445d72c67d4e2c59629e389f40c158a` |
| `ADMIN_PASSWORD_HASH` | `$2a$12$SjmIOLOKxLVbAXjJeQ.pnOnKf54NcQoM/zQtkoA4cxQrZUwN3SW4C` |
| `QR_PUBLIC_TOKEN` | `015268fc6af494d0da3cdfa68ea8ed7b7d165560fa7988775f10a7a28d05bc74` |
| `PUBLIC_URL` | La URL que Railway te asigne, por ejemplo `https://autorizacion-biometrica.up.railway.app` |
| `RAZON_SOCIAL` | `CENTRALES ELECTRICAS DE NARIÑO S.A. E.S.P.` |
| `NIT` | `891200200-8` |
| `CORREO_PROTECCION_DATOS` | `consulta.protecciondatospersonales@cedenar.com.co` |
| `LINEA_ATENCION` | `602 7244321` |
| `DIRECCION_EMPRESA` | `Calle 20 No. 36 - 12, Avenida de los Estudiantes de la ciudad de Pasto` |
| `RESPONSABLE_TRATAMIENTO` | `CENTRALES ELECTRICAS DE NARIÑO S.A. E.S.P. - CEDENAR S.A. E.S.P.` |
| `VERSION_AUTORIZACION` | `2.0` |
| `POLITICA_PRIVACIDAD_URL` | `https://www.cedenar.com.co/` |

`PORT` la asigna Railway automáticamente; el código ya la lee.

## 4. Importante: base de datos y archivos en Railway

Railway usa un disco **efímero**: al redesplegar se pierden `data/biometrico.sqlite` y los PDFs. Para producción tienes dos opciones:

**Opción A – Volumen persistente (recomendada y simple):**
1. En Railway → tu servicio → **Volumes → New Volume**.
2. Monta el volumen en la ruta `/app/data`.
3. La base SQLite y los PDFs quedarán persistentes.

**Opción B – Supabase PostgreSQL + Storage:** requiere migrar la capa de datos (la estructura ya está preparada en el código para una futura migración).

## 5. El listado de trabajadores

El archivo `PLANTA PERSONAL - TERMNO INDEFINIDO Y FIJO.xlsx` está en el repositorio, así que al arrancar en Railway se cargan automáticamente los 556 trabajadores. Si el Excel contiene información que no debe ser pública en GitHub, usa un **repositorio privado**.

## 6. Acceso después del despliegue

- Formulario público: `https://TU-APP.up.railway.app/?token=TU_QR_PUBLIC_TOKEN`
- Panel administrativo: `https://TU-APP.up.railway.app/admin`
- Contraseña del panel: la que definiste (solo el hash está en el servidor; nadie puede leerla en texto plano).
- Genera el QR desde el botón **Generar QR** del panel: quedará apuntando a la URL de producción con el token.

## 7. HTTPS

Railway expone HTTPS automáticamente. Como `NODE_ENV=production`, las cookies de sesión viajan con `Secure` y `HttpOnly`.
