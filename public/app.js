const state = { employee: null, token: new URLSearchParams(location.search).get('token') || '' };
const $ = (id) => document.getElementById(id);
const api = (url, options = {}) => fetch(`${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(state.token)}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }).then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'No fue posible completar la solicitud.'); return data; });
const lookupForm = $('lookupForm');
const signatureCanvas = $('signatureCanvas');
const signaturePad = new SignaturePad(signatureCanvas, { minWidth: 1, maxWidth: 2.4, penColor: '#003a75' });

function resizeCanvas() { const ratio = Math.max(window.devicePixelRatio || 1, 1); const bounds = signatureCanvas.getBoundingClientRect(); signatureCanvas.width = bounds.width * ratio; signatureCanvas.height = bounds.height * ratio; signatureCanvas.getContext('2d').scale(ratio, ratio); signaturePad.clear(); }
window.addEventListener('resize', resizeCanvas); resizeCanvas();
function showMessage(target, text, type = 'error') { target.textContent = text; target.className = `message ${type}`; }
function escapeHtmlLocal(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function paintAuthorization() {
  if (!state.employee) return;
  const e = state.employee;
  const ciudad = ($('ciudad').value || '').trim();
  const u = (t) => `<span class="campo">${escapeHtmlLocal(t)}</span>`;
  const ciudadHtml = ciudad ? u(ciudad) : '<span class="campo campo-vacio">______________________</span>';
  $('authorizationText').innerHTML = `
    <div class="fo-head">
      <img src="/logo-oficial.png" alt="CEDENAR" class="fo-logo">
      <div class="fo-titulo">AUTORIZACIÓN PARA EL TRATAMIENTO DE<br>DATOS PERSONALES BIOMÉTRICOS PARA<br>INGRESO A LAS INSTALACIONES</div>
      <div class="fo-control"><strong>FOR-GDA-GHU-019</strong><span>VERSIÓN: 1.0</span><span>08/SEP/2026</span></div>
    </div>
    <div class="fo-cuerpo">
      <p>Yo, ${u(e.nombre)}, identificado(a) con cédula de ciudadanía No. ${u(e.cedula)} de la ciudad de ${ciudadHtml}, autorizo a las <strong>CENTRALES ELÉCTRICAS DE NARIÑO S.A. E.S.P. - CEDENAR S.A. E.S.P.</strong>, ubicada en la Calle 20 No. 36 - 12, Avenida de los Estudiantes de la ciudad de Pasto, para que recolecte, almacene, use, circule y/o suprima mis datos personales, que se capturan en este medio, incluyendo el tratamiento de datos sensibles, aun conociendo que no estoy obligado(a) a autorizarlo. Lo anterior con el fin de registrar y utilizar mi imagen para fines de identificación biométrica, que permitan controlar mi ingreso como trabajador a las oficinas de CEDENAR S.A. E.S.P; así como para las demás finalidades de la Política de Tratamiento de Información disponible en www.cedenar.com.co, la cual declaro conocer y aceptar, así como entender que en esta se especifican cuáles datos son sensibles.</p>
      <p>Declaro conocer que, como titular, me asisten los derechos a conocer, actualizar y rectificar mis datos personales, así como a solicitar el cese de su tratamiento y dejar sin efecto el consentimiento previamente otorgado. Estos derechos los podré ejercer a través de los canales dispuestos por CEDENAR S.A. E.S.P. para la atención de requerimientos relacionados con el tratamiento de datos personales, en el correo electrónico <span class="fo-link">consulta.protecciondatospersonales@cedenar.com.co</span>, en la línea de atención <span class="fo-link">602 7244321</span> o a través de la página web <span class="fo-link">www.cedenar.com.co</span>.</p>
      <p class="fo-atentamente">Atentamente,</p>
      <div class="fo-firmas">
        <div class="fo-fila"><span>Firma:</span><i id="foFirmaVista"></i></div>
        <div class="fo-fila"><span>Nombre:</span><i>${u(e.nombre)}</i></div>
        <div class="fo-fila"><span>C.C. No.:</span><i>${u(e.cedula)}</i></div>
      </div>
    </div>
    <div class="fo-pie">Calle 20 N° 36 – 12 Av. Los estudiantes · Contact Center 115 · www.cedenar.com.co Pasto – Nariño – Colombia</div>`;
}
function renderEmployee(data) {
  state.employee = data;
  $('employeePanel').classList.remove('hidden');
  $('employeeName').textContent = data.nombre; $('employeeCedula').textContent = data.cedula; $('employeeCargo').textContent = data.cargo || 'No registrado'; $('employeeArea').textContent = data.dependencia || 'No registrada'; $('currentDate').textContent = data.date;
  $('authorizationPanel').classList.remove('hidden'); paintAuthorization();
  if (data.estado === 'AUTORIZADO') { $('alreadyAuthorized').classList.remove('hidden'); $('alreadyAuthorized').textContent = `Esta autorización ya fue registrada el ${data.fecha_autorizacion}. Por seguridad no es posible firmar nuevamente.`; $('signaturePanel').classList.add('hidden'); } else { $('alreadyAuthorized').classList.add('hidden'); $('signaturePanel').classList.remove('hidden'); setTimeout(resizeCanvas, 0); }
}
lookupForm.addEventListener('submit', async (event) => { event.preventDefault(); const button = lookupForm.querySelector('button'); button.disabled = true; showMessage($('lookupMessage'), 'Consultando...', 'success'); try { renderEmployee(await api(`/api/empleado/${encodeURIComponent($('cedula').value)}`)); showMessage($('lookupMessage'), 'Información encontrada. Continúa con la lectura del documento.', 'success'); } catch (error) { $('employeePanel').classList.add('hidden'); $('authorizationPanel').classList.add('hidden'); $('signaturePanel').classList.add('hidden'); showMessage($('lookupMessage'), error.message); } finally { button.disabled = false; } });
$('clearSignature').addEventListener('click', () => { signaturePad.clear(); $('signatureStatus').textContent = 'Firma pendiente'; });
$('ciudad').addEventListener('input', paintAuthorization);
signatureCanvas.addEventListener('pointerup', () => { if (!signaturePad.isEmpty()) $('signatureStatus').textContent = 'Firma lista para guardar'; });
$('saveAuthorization').addEventListener('click', async () => { const button = $('saveAuthorization'); if (!state.employee) return; if (!$('consent').checked) return showMessage($('saveMessage'), 'Debes marcar la casilla de consentimiento antes de guardar.'); if (signaturePad.isEmpty()) return showMessage($('saveMessage'), 'Dibuja tu firma manuscrita antes de guardar.'); button.disabled = true; showMessage($('saveMessage'), 'Guardando autorización y generando constancia...', 'success'); try { const result = await api('/api/autorizaciones', { method: 'POST', body: JSON.stringify({ cedula: state.employee.cedula, ciudad: $('ciudad').value, autorizacionAceptada: true, firma: signaturePad.toDataURL('image/png') }) }); $('signaturePanel').classList.add('hidden'); $('confirmation').classList.remove('hidden'); $('confirmationText').textContent = `Registro confirmado para ${result.employee.nombre}. Fecha y hora: ${result.employee.fecha_autorizacion}. Descarga tu soporte individual.`; $('downloadLink').href = result.download; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } catch (error) { showMessage($('saveMessage'), error.message); button.disabled = false; } });
