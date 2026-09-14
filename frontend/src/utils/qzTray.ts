import qz from "qz-tray";
import { API_BASE_URL } from "../api/config";

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
