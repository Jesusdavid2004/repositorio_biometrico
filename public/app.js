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
  const ciudad = ($('ciudad').value || '').trim();
  const text = state.employee.authorization.replace('de la ciudad de ______________________,', `de la ciudad de ${ciudad || '______________________'},`);
  let html = '<h3 class="legal-title">Autorización registro biométrico para ingreso a instalaciones</h3>';
  for (const paragraph of text.split('\n\n')) {
    let safe = escapeHtmlLocal(paragraph)
      .replace(escapeHtmlLocal(state.employee.nombre), `<u><strong>${escapeHtmlLocal(state.employee.nombre)}</strong></u>`)
      .replace(`No. ${escapeHtmlLocal(state.employee.cedula)}`, `No. <u><strong>${escapeHtmlLocal(state.employee.cedula)}</strong></u>`);
    if (ciudad) safe = safe.replace(`de la ciudad de ${escapeHtmlLocal(ciudad)},`, `de la ciudad de <u><strong>${escapeHtmlLocal(ciudad)}</strong></u>,`);
    html += `<p>${safe}</p>`;
  }
  $('authorizationText').innerHTML = html;
}
function renderEmployee(data) {
  state.employee = data;
  $('employeePanel').classList.remove('hidden');
  $('employeeName').textContent = data.nombre; $('employeeCedula').textContent = data.cedula; $('employeeCargo').textContent = data.cargo || 'No registrado'; $('employeeArea').textContent = data.dependencia || 'No registrada'; $('currentDate').textContent = data.date;
  $('authorizationPanel').classList.remove('hidden'); paintAuthorization(); $('versionLabel').textContent = `Versión ${data.version || 'vigente'}`;
  if (data.estado === 'AUTORIZADO') { $('alreadyAuthorized').classList.remove('hidden'); $('alreadyAuthorized').textContent = `Esta autorización ya fue registrada el ${data.fecha_autorizacion}. Por seguridad no es posible firmar nuevamente.`; $('signaturePanel').classList.add('hidden'); } else { $('alreadyAuthorized').classList.add('hidden'); $('signaturePanel').classList.remove('hidden'); setTimeout(resizeCanvas, 0); }
}
lookupForm.addEventListener('submit', async (event) => { event.preventDefault(); const button = lookupForm.querySelector('button'); button.disabled = true; showMessage($('lookupMessage'), 'Consultando...', 'success'); try { renderEmployee(await api(`/api/empleado/${encodeURIComponent($('cedula').value)}`)); showMessage($('lookupMessage'), 'Información encontrada. Continúa con la lectura del documento.', 'success'); } catch (error) { $('employeePanel').classList.add('hidden'); $('authorizationPanel').classList.add('hidden'); $('signaturePanel').classList.add('hidden'); showMessage($('lookupMessage'), error.message); } finally { button.disabled = false; } });
$('clearSignature').addEventListener('click', () => { signaturePad.clear(); $('signatureStatus').textContent = 'Firma pendiente'; });
$('ciudad').addEventListener('input', paintAuthorization);
signatureCanvas.addEventListener('pointerup', () => { if (!signaturePad.isEmpty()) $('signatureStatus').textContent = 'Firma lista para guardar'; });
$('saveAuthorization').addEventListener('click', async () => { const button = $('saveAuthorization'); if (!state.employee) return; if (!$('consent').checked) return showMessage($('saveMessage'), 'Debes marcar la casilla de consentimiento antes de guardar.'); if (signaturePad.isEmpty()) return showMessage($('saveMessage'), 'Dibuja tu firma manuscrita antes de guardar.'); button.disabled = true; showMessage($('saveMessage'), 'Guardando autorización y generando constancia...', 'success'); try { const result = await api('/api/autorizaciones', { method: 'POST', body: JSON.stringify({ cedula: state.employee.cedula, ciudad: $('ciudad').value, autorizacionAceptada: true, firma: signaturePad.toDataURL('image/png') }) }); $('signaturePanel').classList.add('hidden'); $('confirmation').classList.remove('hidden'); $('confirmationText').textContent = `Registro confirmado para ${result.employee.nombre}. Fecha y hora: ${result.employee.fecha_autorizacion}. Descarga tu soporte individual.`; $('downloadLink').href = result.download; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } catch (error) { showMessage($('saveMessage'), error.message); button.disabled = false; } });
