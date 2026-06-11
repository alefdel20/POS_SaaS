import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useParams } from "react-router-dom";

const API_URL =
  (import.meta as any).env.VITE_API_BASE_URL || "/api";

const ACCENT_PALETTES: Record<string, string> = {
  default: "#6366f1",
  ocean: "#0ea5e9",
  forest: "#22c55e",
  ember: "#f97316"
};

type MenuProduct = {
  name: string;
  description: string;
  image_path: string | null;
  price: number;
};

type MenuCategory = {
  name: string;
  products: MenuProduct[];
};

type PublicMenu = {
  business: {
    name: string;
    accent_palette: string;
    business_image_path: string | null;
  };
  categories: MenuCategory[];
};

function getApiOrigin(): string {
  try {
    return new URL(API_URL).origin;
  } catch {
    return "";
  }
}

function resolveAssetUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const origin = getApiOrigin();
  return origin ? `${origin}${path}` : path;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number.isFinite(value) ? value : 0);
}

export function PublicMenuPage() {
  const { slug } = useParams<{ slug: string }>();
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setMenu(null);

    fetch(`${API_URL}/menu/${encodeURIComponent(slug || "")}`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404) {
          setStatus("notfound");
          return;
        }
        if (!response.ok) {
          setStatus("error");
          return;
        }
        const data: PublicMenu = await response.json();
        if (cancelled) return;
        setMenu(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (status === "loading") {
    return (
      <div style={styles.centered}>
        <p style={{ color: "#64748b" }}>Cargando menú…</p>
      </div>
    );
  }

  if (status === "notfound") {
    return (
      <div style={styles.centered}>
        <h1 style={{ fontSize: "1.5rem", color: "#0f172a" }}>Menú no encontrado</h1>
        <p style={{ color: "#64748b" }}>El negocio que buscas no existe o no está disponible.</p>
      </div>
    );
  }

  if (status === "error" || !menu) {
    return (
      <div style={styles.centered}>
        <h1 style={{ fontSize: "1.5rem", color: "#0f172a" }}>Algo salió mal</h1>
        <p style={{ color: "#64748b" }}>No pudimos cargar el menú. Intenta de nuevo más tarde.</p>
      </div>
    );
  }

  const accent = ACCENT_PALETTES[menu.business.accent_palette] || ACCENT_PALETTES.default;
  const logoUrl = resolveAssetUrl(menu.business.business_image_path);

  return (
    <div style={styles.page}>
      <header style={{ ...styles.header, borderTopColor: accent }}>
        {logoUrl ? (
          <img src={logoUrl} alt={menu.business.name} style={styles.logo} />
        ) : (
          <div style={{ ...styles.logoFallback, backgroundColor: accent }}>
            {menu.business.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 style={{ ...styles.businessName, color: accent }}>{menu.business.name}</h1>
      </header>

      <main style={styles.main}>
        {menu.categories.length === 0 ? (
          <p style={{ color: "#64748b", textAlign: "center" }}>
            Este menú aún no tiene productos disponibles.
          </p>
        ) : (
          menu.categories.map((category) => (
            <section key={category.name} style={styles.category}>
              <h2 style={{ ...styles.categoryTitle, borderBottomColor: accent }}>
                {category.name}
              </h2>
              <ul style={styles.productList}>
                {category.products.map((product, index) => {
                  const imageUrl = resolveAssetUrl(product.image_path);
                  return (
                    <li key={`${product.name}-${index}`} style={styles.productItem}>
                      {imageUrl && (
                        <img src={imageUrl} alt={product.name} style={styles.productImage} />
                      )}
                      <div style={styles.productInfo}>
                        <div style={styles.productHeader}>
                          <span style={styles.productName}>{product.name}</span>
                          <span style={{ ...styles.productPrice, color: accent }}>
                            {formatPrice(product.price)}
                          </span>
                        </div>
                        {product.description && (
                          <p style={styles.productDescription}>{product.description}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
  },
  centered: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    textAlign: "center",
    padding: "2rem",
    backgroundColor: "#f8fafc",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
  },
  header: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    padding: "2.5rem 1.5rem 2rem",
    backgroundColor: "#ffffff",
    borderTop: "6px solid",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)"
  },
  logo: {
    width: "96px",
    height: "96px",
    objectFit: "cover",
    borderRadius: "50%",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.12)"
  },
  logoFallback: {
    width: "96px",
    height: "96px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    fontSize: "2.5rem",
    fontWeight: 700
  },
  businessName: {
    margin: 0,
    fontSize: "1.75rem",
    fontWeight: 700,
    textAlign: "center"
  },
  main: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: "2rem 1.5rem 3rem"
  },
  category: {
    marginBottom: "2rem"
  },
  categoryTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "#0f172a",
    paddingBottom: "0.5rem",
    marginBottom: "1rem",
    borderBottom: "2px solid"
  },
  productList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1rem"
  },
  productItem: {
    display: "flex",
    gap: "1rem",
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "1rem",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)"
  },
  productImage: {
    width: "72px",
    height: "72px",
    objectFit: "cover",
    borderRadius: "8px",
    flexShrink: 0
  },
  productInfo: {
    flex: 1,
    minWidth: 0
  },
  productHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "0.75rem"
  },
  productName: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#0f172a"
  },
  productPrice: {
    fontSize: "1rem",
    fontWeight: 700,
    whiteSpace: "nowrap"
  },
  productDescription: {
    margin: "0.35rem 0 0",
    fontSize: "0.875rem",
    color: "#64748b",
    lineHeight: 1.4
  }
};
