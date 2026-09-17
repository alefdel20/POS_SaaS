import qz from "qz-tray";
import { API_BASE_URL } from "../api/config";
import { THERMAL_ROLL_WIDTH_MM, THERMAL_PRINTABLE_WIDTH_MM, THERMAL_PRINTABLE_LEFT_OFFSET_MM } from "../utils/print";

let configured = false;

// qz-tray ships as a plain CommonJS/UMD module with no bundled or published
// @types package (checked node_modules/qz-tray — package.json has no
// "types" field and there's no .d.ts anywhere in it), so its calls are
// necessarily untyped (any) here.

function fetchCertificate(): Promise<string> {
  return fetch(`${API_BASE_URL}/print/certificate`).then((response) => {
    if (!response.ok) {
      throw new Error("No fue posible obtener el certificado de QZ Tray");
    }
    return response.text();
  });
}

// apiRequest (frontend/src/api/client.ts:24-47) always parses the response
// as JSON, but POST /print/sign responds with the raw base64 signature as
// plain text (printController.js's getCertificate/signRequest both use
// res.type("text/plain").send(...) to match QZ Tray's own client contract —
// see https://qz.io/docs/signing). So this can't call apiRequest directly
// without it throwing on response.json(); instead it replicates apiRequest's
// exact Authorization-header convention (client.ts:32-34: Bearer <token> via
// options.token, never read from localStorage) with a plain fetch call.
function signWithBackend(token: string, requestToSign: string): Promise<string> {
  return fetch(`${API_BASE_URL}/print/sign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ request: requestToSign })
  }).then((response) => {
    if (!response.ok) {
      throw new Error("No fue posible firmar la solicitud de impresión");
    }
    return response.text();
  });
}

export function configureQz(token: string) {
  if (configured) {
    return;
  }
  configured = true;

  qz.security.setSignatureAlgorithm("SHA512");

  qz.security.setCertificatePromise((resolve: (value: string) => void, reject: (reason: unknown) => void) => {
    fetchCertificate().then(resolve).catch(reject);
  });

  qz.security.setSignaturePromise((requestToSign: string) => (resolve: (value: string) => void, reject: (reason: unknown) => void) => {
    signWithBackend(token, requestToSign).then(resolve).catch(reject);
  });
}

export function connectQz(token: string): Promise<void> {
  configureQz(token);
  return qz.websocket.connect();
}

export function isQzConnected(): boolean {
  return qz.websocket.isActive();
}

// Data shape confirmed against the installed qz-tray v2.3.0 source
// (node_modules/qz-tray/qz-tray.js): type defaults to 'raw' and flavor
// defaults to 'file' if omitted, so both must be set explicitly here -
// otherwise QZ either expects options.language (raw) or treats `data` as
// a file path/URL (file flavor) instead of an inline HTML string.
export function printTicketViaQz(printerName: string, bodyHtml: string): Promise<void> {
  if (!isQzConnected()) {
    throw new Error("QZ Tray no está conectado");
  }

  const config = qz.configs.create(printerName, {
    size: { width: THERMAL_ROLL_WIDTH_MM, height: 297 },
    units: "mm",
    scaleContent: true,
    margins: {
      left: THERMAL_PRINTABLE_LEFT_OFFSET_MM,
      right: THERMAL_ROLL_WIDTH_MM - THERMAL_PRINTABLE_WIDTH_MM - THERMAL_PRINTABLE_LEFT_OFFSET_MM,
      top: 0,
      bottom: 0
    }
  });

  return qz.print(config, [{ type: "pixel", format: "html", flavor: "plain", data: bodyHtml }]);
}
