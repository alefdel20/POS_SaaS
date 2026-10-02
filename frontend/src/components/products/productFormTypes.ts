import type { SaleUnit } from "../../constants/saleUnits";

export const NEW_PRODUCT_DRAFT_VERSION = 1;

export type ProductSupplierFormState = {
  supplier_id: string;
  supplier_name: string;
  supplier_email: string;
  supplier_phone: string;
  supplier_whatsapp: string;
  supplier_observations: string;
  purchase_cost: string;
  cost_updated_at: string | null;
};

export type ProductFormState = {
  name: string;
  sku: string;
  barcode_manually_edited: boolean;
  barcode: string;
  category: string;
  description: string;
  price: string;
  cost_price: string;
  ieps: string;
  porcentaje_ganancia: string;
  unidad_de_venta: SaleUnit | "";
  stock: string;
  stock_minimo: string;
  stock_maximo: string;
  expires_at: string;
  lot_number: string;
  is_active: boolean;
  status: "activo" | "inactivo";
  suppliers: ProductSupplierFormState[];
  discount_type: "" | "percentage" | "fixed";
  discount_value: string;
  discount_start: string;
  discount_end: string;
};

export const emptySupplier: ProductSupplierFormState = {
  supplier_id: "",
  supplier_name: "",
  supplier_email: "",
  supplier_phone: "",
  supplier_whatsapp: "",
  supplier_observations: "",
  purchase_cost: "",
  cost_updated_at: null
};

export const emptyProduct: ProductFormState = {
  name: "",
  sku: "",
  barcode_manually_edited: false,
  barcode: "",
  category: "",
  description: "",
  price: "",
  cost_price: "",
  ieps: "",
  porcentaje_ganancia: "",
  unidad_de_venta: "",
  stock: "",
  stock_minimo: "",
  stock_maximo: "",
  expires_at: "",
  lot_number: "",
  is_active: true,
  status: "activo",
  suppliers: [{ ...emptySupplier }],
  discount_type: "",
  discount_value: "",
  discount_start: "",
  discount_end: ""
};
