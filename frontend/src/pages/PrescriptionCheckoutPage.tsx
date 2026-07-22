import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalConsultation, MedicalPrescription, MedicalPrescriptionItem, Product, Sale, SaleReceipt } from "../types";
import { currency } from "../utils/format";
import { getPaymentMethodLabel } from "../utils/uiLabels";
import { canUseCreditCollections } from "../utils/pos";

const CONSULTATION_PRODUCT_SKU = "SERV-CONSULTA";
const RETURN_PATH = "/health/consultations/recetas";

type ResolvedMedicationItem = {
  item: MedicalPrescriptionItem;
  product: Product;
};

type SaleItemPayload = {
  product_id: number;
  quantity: number;
  unit_price: number;
  prescription_item_id?: number;
};

type PaymentMethod = "cash" | "card" | "credit" | "transfer";

export function PrescriptionCheckoutPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const consultationIdParam = searchParams.get("consultation_id");
  const prescriptionIdParam = searchParams.get("prescription_id");
  const consultationId = Number(consultationIdParam);
  const prescriptionId = prescriptionIdParam ? Number(prescriptionIdParam) : null;

  const isDirectCharge = Boolean(user?.cobro_directo);
  const canUseCredit = canUseCreditCollections(user?.pos_type);

  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [detail, setDetail] = useState<ClinicalConsultation | null>(null);
  const [prescription, setPrescription] = useState<MedicalPrescription | null>(null);
  const [medicationItems, setMedicationItems] = useState<ResolvedMedicationItem[]>([]);
  const [freeMedicationWarning, setFreeMedicationWarning] = useState("");

  const [consultationProduct, setConsultationProduct] = useState<Product | null>(null);
  const [consultationProductError, setConsultationProductError] = useState("");

  const [chargeConsultation, setChargeConsultation] = useState(false);
  const [consultationAmount, setConsultationAmount] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  useEffect(() => {
    if (!token) return;
    if (!Number.isInteger(consultationId) || consultationId <= 0) {
      setInitError("Falta el parametro consultation_id. Vuelve a la consulta e intenta de nuevo.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setInitError("");
      try {
        const consultationDetail = await apiRequest<ClinicalConsultation>(`/medical-consultations/${consultationId}`, { token: token! });
        if (cancelled) return;
        setDetail(consultationDetail);

        if (prescriptionId && Number.isInteger(prescriptionId) && prescriptionId > 0) {
          try {
            const prescriptionDetail = await apiRequest<MedicalPrescription>(`/medical-prescriptions/${prescriptionId}`, { token: token! });
            if (cancelled) return;
            setPrescription(prescriptionDetail);

            const warnings: string[] = [];
            const resolved: ResolvedMedicationItem[] = [];
            for (const item of prescriptionDetail.items) {
              if (item.product_id === null) {
                warnings.push(`El medicamento recetado "${item.medication_name_snapshot}" es libre (sin producto de catalogo) y no se puede agregar al cobro.`);
                continue;
              }
              try {
                const product = await apiRequest<Product>(`/products/${item.product_id}`, { token: token! });
                resolved.push({ item, product });
              } catch {
                warnings.push(`El producto recetado "${item.medication_name_snapshot}" ya no existe o no esta disponible.`);
              }
            }
            if (!cancelled) {
              setMedicationItems(resolved);
              setFreeMedicationWarning(warnings.join(" "));
            }
          } catch (prescriptionError) {
            if (!cancelled) {
              setError(prescriptionError instanceof Error ? prescriptionError.message : "No fue posible cargar la receta");
            }
          }
        }

        try {
          const products = await apiRequest<Product[]>(`/products?search=${encodeURIComponent(CONSULTATION_PRODUCT_SKU)}&activeOnly=true`, { token: token! });
          if (!cancelled) {
            const match = products.find((product) => product.sku?.toUpperCase() === CONSULTATION_PRODUCT_SKU) || products[0] || null;
            if (match) {
              setConsultationProduct(match);
            } else {
              setConsultationProductError("Producto de consulta no configurado para este negocio, contacta soporte.");
            }
          }
        } catch {
          if (!cancelled) {
            setConsultationProductError("Producto de consulta no configurado para este negocio, contacta soporte.");
          }
        }
      } catch (detailError) {
        if (!cancelled) {
          setInitError(detailError instanceof Error ? detailError.message : "No fue posible cargar la consulta");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [token, consultationId, prescriptionId]);

  const medicationsTotal = useMemo(
    () => medicationItems.reduce((sum, { item, product }) => {
      const quantity = item.quantity ?? 1;
      const unitPrice = product.effective_price ?? product.price;
      return sum + quantity * unitPrice;
    }, 0),
    [medicationItems]
  );

  const consultationAmountNumber = Number(consultationAmount || 0);
  const hasValidConsultationAmount = !chargeConsultation || (consultationAmount.trim() !== "" && consultationAmountNumber > 0);
  const total = medicationsTotal + (chargeConsultation ? consultationAmountNumber : 0);
  const hasNothingToCharge = medicationItems.length === 0 && !chargeConsultation;

  const cashReceivedAmount = Number(cashReceived || 0);
  const cashChange = Math.max(cashReceivedAmount - total, 0);
  const hasValidCashReceived = paymentMethod !== "cash"
    || (cashReceived.trim() !== "" && cashReceivedAmount > 0 && cashReceivedAmount >= total);

  function resetFeedback() {
    setError("");
  }

  function goBack(status?: "paid" | "sent") {
    const params = new URLSearchParams({ consultation: String(consultationId) });
    if (status) params.set("checkout", status);
    navigate(`${RETURN_PATH}?${params.toString()}`);
  }

  function buildMedicationItemsPayload(): SaleItemPayload[] {
    return medicationItems.map(({ item, product }) => ({
      product_id: product.id,
      quantity: item.quantity ?? 1,
      unit_price: product.effective_price ?? product.price,
      prescription_item_id: item.id
    }));
  }

  async function handleChargeDirect() {
    if (!token || submitting) return;
    resetFeedback();

    if (hasNothingToCharge) {
      setError("No hay nada que cobrar");
      return;
    }
    if (chargeConsultation && !hasValidConsultationAmount) {
      setError("Captura el monto de la consulta");
      return;
    }
    if (paymentMethod === "cash" && !hasValidCashReceived) {
      setError(cashReceived.trim() === "" ? "Debes capturar el dinero recibido" : "El dinero recibido no cubre el total");
      return;
    }
    if (paymentMethod === "credit" && !customerName.trim()) {
      setError("Debes capturar el nombre del cliente");
      return;
    }

    const items = buildMedicationItemsPayload();
    if (chargeConsultation && consultationProduct) {
      items.push({
        product_id: consultationProduct.id,
        quantity: 1,
        unit_price: consultationAmountNumber
      });
    }

    try {
      setSubmitting(true);
      await apiRequest<{ sale: Sale; warnings: string[]; receipt: SaleReceipt }>("/sales", {
        method: "POST",
        token,
        body: JSON.stringify({
          prescription_id: prescriptionId || undefined,
          payment_method: paymentMethod,
          cash_received: paymentMethod === "cash" ? cashReceivedAmount : undefined,
          sale_type: "ticket",
          customer: paymentMethod === "credit" ? { name: customerName.trim(), phone: customerPhone.trim() } : undefined,
          initial_payment: 0,
          items
        })
      });
      goBack("paid");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible cobrar la venta");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendToQueue() {
    if (!token || submitting) return;
    resetFeedback();

    if (hasNothingToCharge) {
      setError("No hay nada que cobrar");
      return;
    }
    if (chargeConsultation && !hasValidConsultationAmount) {
      setError("Captura el monto de la consulta");
      return;
    }

    try {
      setSubmitting(true);
      await apiRequest("/prescription-checkout-requests", {
        method: "POST",
        token,
        body: JSON.stringify({
          consultation_id: consultationId,
          prescription_id: prescriptionId || undefined,
          charge_consultation: chargeConsultation,
          consultation_amount: chargeConsultation ? consultationAmountNumber : undefined
        })
      });
      goBack("sent");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible enviar a caja");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="page-grid">
        <div className="panel">
          <p className="muted">Cargando...</p>
        </div>
      </section>
    );
  }

  if (initError) {
    return (
      <section className="page-grid">
        <div className="panel">
          <div className="empty-state-card">
            <strong>No fue posible abrir el cobro.</strong>
            <span className="muted">{initError}</span>
            <div className="inline-actions">
              <button className="button ghost" onClick={() => navigate(RETURN_PATH)} type="button">Volver</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Pasar a cobro</h2>
            <p className="muted">Paciente: {detail?.patient_name}</p>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {freeMedicationWarning ? <p className="error-text">{freeMedicationWarning}</p> : null}
        {consultationProductError ? <p className="error-text">{consultationProductError}</p> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Medicamento</th>
                <th>Cantidad</th>
                <th>Precio</th>
              </tr>
            </thead>
            <tbody>
              {medicationItems.map(({ item, product }) => (
                <tr key={item.id}>
                  <td>{product.name}</td>
                  <td>{item.quantity ?? 1}</td>
                  <td>{currency((product.effective_price ?? product.price) * (item.quantity ?? 1))}</td>
                </tr>
              ))}
              {!medicationItems.length ? (
                <tr>
                  <td className="muted" colSpan={3}>Sin medicamentos en esta receta.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <label className="checkbox-row">
          <input
            checked={chargeConsultation}
            disabled={!consultationProduct}
            onChange={(event) => setChargeConsultation(event.target.checked)}
            type="checkbox"
          />
          <span>Cobrar consulta</span>
        </label>
        {chargeConsultation ? (
          <label>
            Monto de la consulta *
            <input
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={consultationAmount}
              onChange={(event) => setConsultationAmount(event.target.value)}
            />
          </label>
        ) : null}

        <div className="total-box">
          <span>Total a cobrar</span>
          <strong>{currency(total)}</strong>
        </div>

        {isDirectCharge ? (
          <div className="form-section-grid">
            <label>
              Metodo de pago
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                <option value="cash">{getPaymentMethodLabel("cash")}</option>
                <option value="card">{getPaymentMethodLabel("card")}</option>
                {canUseCredit ? <option value="credit">{getPaymentMethodLabel("credit")}</option> : null}
                <option value="transfer">{getPaymentMethodLabel("transfer")}</option>
              </select>
            </label>

            {paymentMethod === "cash" ? (
              <>
                <label>
                  Dinero recibido *
                  <input
                    autoFocus
                    min="0"
                    inputMode="decimal"
                    step="0.01"
                    type="number"
                    value={cashReceived}
                    onChange={(event) => setCashReceived(event.target.value)}
                  />
                </label>
                {!hasValidCashReceived ? <p className="error-text">Captura un monto igual o mayor al total para finalizar el cobro.</p> : null}
                <div className="total-box secondary">
                  <span>Cambio</span>
                  <strong>{currency(cashChange)}</strong>
                </div>
              </>
            ) : null}

            {paymentMethod === "credit" ? (
              <>
                <label>
                  Nombre del cliente *
                  <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
                </label>
                <label>
                  Telefono
                  <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
                </label>
              </>
            ) : null}

            <div className="inline-actions">
              <button
                className="button"
                disabled={submitting || hasNothingToCharge}
                onClick={handleChargeDirect}
                type="button"
              >
                {submitting ? "Procesando..." : "Cobrar"}
              </button>
              <button className="button ghost" disabled={submitting} onClick={() => goBack()} type="button">Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="inline-actions">
            <button
              className="button"
              disabled={submitting || hasNothingToCharge}
              onClick={handleSendToQueue}
              type="button"
            >
              {submitting ? "Enviando..." : "Enviar a caja"}
            </button>
            <button className="button ghost" disabled={submitting} onClick={() => goBack()} type="button">Cancelar</button>
          </div>
        )}
      </div>
    </section>
  );
}
