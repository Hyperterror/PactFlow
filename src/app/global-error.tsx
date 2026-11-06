"use client";

/**
 * Last resort: this replaces the root layout, so it cannot rely on the design
 * tokens or any client component. Requirement 4.7 asks for a way forward instead
 * of a blank tab, which is all this file has to guarantee.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f3ed",
          color: "#27312e",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 24,
        }}
      >
        <main style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>PactFlow could not start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#5c6963", marginTop: 12 }}>
            {error.message || "An unexpected error stopped the application from rendering."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              background: "#193c35",
              color: "#f7f5ef",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
