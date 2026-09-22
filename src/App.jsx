import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, PackagePlus, PackageMinus, Plus, Minus, X, Loader2, Check, AlertCircle } from "lucide-react";

const INK = "#2B2320";
const PAPER = "#FAF6F0";
const SURFACE = "#FFFFFF";
const BORDER = "#E4DCD1";
const BERRY = "#A8365A";
const SAGE = "#6B8F71";
const MUTED = "#8A7F73";

const sansFont = "ui-sans-serif, system-ui, -apple-system, sans-serif";
const serifFont = "ui-serif, Georgia, 'Times New Roman', serif";
const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";

const CONFIG_KEY = "supabase-config";
const UPC_PATTERN = /^\d{12}$/;

export default function InventoryApp() {
  const [config, setConfig] = useState(null); // { url, key }
  const [configDraft, setConfigDraft] = useState({ url: "", key: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);

  const [flavors, setFlavors] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [upcCodes, setUpcCodes] = useState([]); // [{ upc, flavor_id }]
  const [dataError, setDataError] = useState("");
  const [dataLoading, setDataLoading] = useState(false);

  const [tab, setTab] = useState("in"); // 'in' | 'out' | 'flavor'

  // Receive Stock is now barcode-driven rather than a flavor dropdown.
  const [barcodeForm, setBarcodeForm] = useState({ code: "", mode: null, flavor_id: "", cases: "1", lot: "" });
  const [lotManuallyEdited, setLotManuallyEdited] = useState(false);
  const barcodeInputRef = useRef(null);

  const [outForm, setOutForm] = useState({ flavor_id: "", units: "", order: "", date: todayStr(), item: "" });
  const [flavorForm, setFlavorForm] = useState({ name: "", unitsPerCase: "12", sku: "" });
  const [upcLinkForm, setUpcLinkForm] = useState({ flavor_id: "", upc: "" });

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'ok'|'err', text }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function showToast(type, text) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  // Load saved Supabase config on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          setConfig(parsed);
          setConfigDraft(parsed);
        } else {
          setShowSettings(true);
        }
      } catch {
        setShowSettings(true);
      } finally {
        setConfigLoading(false);
      }
    })();
  }, []);

  const sbFetch = useCallback(
    async (path, options = {}) => {
      if (!config) throw new Error("Not connected yet.");
      const res = await fetch(`${config.url.replace(/\/+$/, "")}/rest/v1/${path}`, {
        ...options,
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(options.headers || {}),
        },
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.message) msg = body.message;
        } catch {}
        throw new Error(msg);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    },
    [config]
  );

  const loadData = useCallback(async () => {
    if (!config) return;
    setDataLoading(true);
    setDataError("");
    try {
      const [f, inv, upcs] = await Promise.all([
        sbFetch("flavors?select=*&order=name.asc"),
        sbFetch("current_inventory?select=*&order=name.asc"),
        sbFetch("upc_codes?select=upc,flavor_id"),
      ]);
      setFlavors(f || []);
      setInventory(inv || []);
      setUpcCodes(upcs || []);
    } catch (e) {
      setDataError(e.message || "Couldn't reach the database.");
    } finally {
      setDataLoading(false);
    }
  }, [config, sbFetch]);

  useEffect(() => {
    if (config) loadData();
  }, [config, loadData]);

  async function saveConfig() {
    const trimmed = { url: configDraft.url.trim(), key: configDraft.key.trim() };
    if (!trimmed.url || !trimmed.key) {
      showToast("err", "Enter both the Project URL and the key.");
      return;
    }
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(trimmed));
    } catch {
      // still proceed even if persistence fails this session
    }
    setConfig(trimmed);
    setShowSettings(false);
  }

  function resetBarcodeForm() {
    setBarcodeForm({ code: "", mode: null, flavor_id: "", cases: "1", lot: "" });
    setLotManuallyEdited(false);
  }

  function handleBarcodeChange(value) {
    const trimmed = value.trim();
    let mode = null;
    if (UPC_PATTERN.test(trimmed)) mode = "upc";
    else if (trimmed.length > 12) mode = "internal";

    setBarcodeForm((prev) => {
      const modeChanged = mode !== prev.mode;
      const next = { ...prev, code: value, mode };

      if (mode === "upc") {
        const match = upcCodes.find((u) => u.upc === trimmed);
        next.flavor_id = match ? match.flavor_id : "";
        next.cases = "1";
        if (modeChanged) next.lot = "";
      } else if (mode === "internal") {
        if (modeChanged) {
          next.flavor_id = "";
          next.cases = "1";
        }
        if (!lotManuallyEdited) next.lot = trimmed.slice(-4);
      } else {
        next.flavor_id = "";
      }
      return next;
    });

    if (mode !== "internal" && !UPC_PATTERN.test(trimmed)) {
      // brand new / cleared scan — allow auto lot-fill again next time
      setLotManuallyEdited(false);
    }
  }

  async function submitInbound() {
    const mode = barcodeForm.mode;
    if (!mode) {
      showToast("err", "Scan a barcode to continue.");
      return;
    }
    if (!barcodeForm.flavor_id) {
      showToast(
        "err",
        mode === "upc" ? "That UPC isn't linked to a flavor yet — link it in the Add Flavor tab." : "Select the flavor for this case."
      );
      return;
    }
    if (!barcodeForm.lot.trim()) {
      showToast("err", "Lot # is required.");
      return;
    }
    const cases = mode === "upc" ? 1 : Number(barcodeForm.cases);
    if (!cases || cases <= 0) {
      showToast("err", "Cases received must be above zero.");
      return;
    }
    setSubmitting(true);
    try {
      await sbFetch("inbound_scans", {
        method: "POST",
        body: JSON.stringify([
          {
            flavor_id: barcodeForm.flavor_id,
            cases_received: cases,
            lot_code: barcodeForm.lot.trim(),
            raw_code: barcodeForm.code.trim(),
          },
        ]),
      });
      showToast("ok", "Logged. Cases added to stock.");
      resetBarcodeForm();
      loadData();
    } catch (e) {
      showToast("err", e.message || "Couldn't save that scan.");
    } finally {
      setSubmitting(false);
      barcodeInputRef.current?.focus();
    }
  }

  async function submitOutbound() {
    if (!outForm.flavor_id || !outForm.units || Number(outForm.units) <= 0 || !outForm.order) {
      showToast("err", "Pick a flavor, order number, and unit count above zero.");
      return;
    }
    setSubmitting(true);
    try {
      await sbFetch("outbound_sales", {
        method: "POST",
        body: JSON.stringify([
          {
            flavor_id: outForm.flavor_id,
            units_sold: Number(outForm.units),
            shipstation_order_number: outForm.order,
            sale_date: outForm.date,
            raw_item_name: outForm.item || null,
          },
        ]),
      });
      showToast("ok", "Logged. Units removed from stock.");
      setOutForm({ flavor_id: outForm.flavor_id, units: "", order: "", date: outForm.date, item: "" });
      loadData();
    } catch (e) {
      showToast("err", e.message || "Couldn't save that sale.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFlavor() {
    if (!flavorForm.name.trim()) {
      showToast("err", "Give the flavor a name.");
      return;
    }
    setSubmitting(true);
    try {
      await sbFetch("flavors", {
        method: "POST",
        body: JSON.stringify([
          {
            name: flavorForm.name.trim(),
            units_per_case: Number(flavorForm.unitsPerCase) || 12,
            sku: flavorForm.sku || null,
          },
        ]),
      });
      showToast("ok", `${flavorForm.name.trim()} added.`);
      setFlavorForm({ name: "", unitsPerCase: "12", sku: "" });
      loadData();
    } catch (e) {
      showToast("err", e.message || "Couldn't add that flavor.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitUpcLink() {
    if (!upcLinkForm.flavor_id || !UPC_PATTERN.test(upcLinkForm.upc.trim())) {
      showToast("err", "Pick a flavor and enter a 12-digit UPC.");
      return;
    }
    setSubmitting(true);
    try {
      await sbFetch("upc_codes", {
        method: "POST",
        body: JSON.stringify([{ flavor_id: upcLinkForm.flavor_id, upc: upcLinkForm.upc.trim() }]),
      });
      showToast("ok", "UPC linked.");
      setUpcLinkForm({ flavor_id: "", upc: "" });
      loadData();
    } catch (e) {
      showToast("err", e.message || "Couldn't link that UPC.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "9px 11px",
    fontSize: 14,
    fontFamily: sansFont,
    color: INK,
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle = {
    display: "block",
    fontSize: 12.5,
    color: MUTED,
    marginBottom: 5,
    fontFamily: sansFont,
  };

  const stepperBtnStyle = {
    width: 34,
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${BORDER}`,
    background: SURFACE,
    borderRadius: 6,
    cursor: "pointer",
    color: INK,
    flexShrink: 0,
  };

  if (configLoading) {
    return (
      <div style={{ background: PAPER, minHeight: 400, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sansFont, color: MUTED }}>
        <Loader2 size={18} className="animate-spin" style={{ marginRight: 8 }} />
        Loading…
      </div>
    );
  }

  const recognizedFlavorName = barcodeForm.flavor_id ? flavors.find((f) => f.id === barcodeForm.flavor_id)?.name : null;

  return (
    <div style={{ background: PAPER, minHeight: 500, fontFamily: sansFont, color: INK, padding: "28px 22px 40px" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 0.8s linear infinite; }
        .duv-tab { transition: color 0.15s ease, border-color 0.15s ease; }
        .duv-row:hover { background: #FBF8F3; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 26, maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}>
        <div>
          <div style={{ fontFamily: serifFont, fontSize: 25, letterSpacing: 0.2, lineHeight: 1.1 }}>Duverger Macarons</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>Inventory ledger</div>
        </div>
        <button
          onClick={() => setShowSettings((s) => !s)}
          style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: 8, cursor: "pointer", color: MUTED, display: "flex" }}
          aria-label="Database settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{ maxWidth: 720, margin: "0 auto 26px", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Connect your Supabase database</div>
            {config && (
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", cursor: "pointer", color: MUTED }}>
                <X size={16} />
              </button>
            )}
          </div>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
            In Supabase, go to Project Settings → API. Copy the <strong>Project URL</strong> and the <strong>anon public key</strong> — never the service_role key — and paste them below.
          </p>
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Project URL</label>
              <input
                style={inputStyle}
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                value={configDraft.url}
                onChange={(e) => setConfigDraft({ ...configDraft, url: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Anon public key (or publishable key)</label>
              <input
                style={inputStyle}
                placeholder="eyJhbGciOi... or sb_publishable_..."
                value={configDraft.key}
                onChange={(e) => setConfigDraft({ ...configDraft, key: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && saveConfig()}
              />
            </div>
            <button
              type="button"
              onClick={saveConfig}
              style={{ background: BERRY, color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
            >
              Connect
            </button>
          </div>
        </div>
      )}

      {config && (
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {dataError && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FBEAEE", border: "1px solid #E9C4CF", color: "#8B2F44", borderRadius: 6, padding: "10px 13px", fontSize: 13, marginBottom: 18 }}>
              <AlertCircle size={15} />
              {dataError}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", gap: 22, borderBottom: `1px solid ${BORDER}`, marginBottom: 20 }}>
            {[
              { id: "in", label: "Receive stock", icon: PackagePlus },
              { id: "out", label: "Record sale", icon: PackageMinus },
              { id: "flavor", label: "Add flavor", icon: Plus },
            ].map((t) => (
              <button
                key={t.id}
                className="duv-tab"
                onClick={() => setTab(t.id)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: tab === t.id ? `2px solid ${BERRY}` : "2px solid transparent",
                  color: tab === t.id ? INK : MUTED,
                  padding: "0 0 10px",
                  fontSize: 13.5,
                  fontWeight: tab === t.id ? 600 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <t.icon size={14} />
                {t.label}
              </button>
            ))}
          </div>

          {/* Receive Stock — barcode driven */}
          {tab === "in" && (
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20, marginBottom: 28 }}>
              <div style={{ marginBottom: barcodeForm.mode ? 14 : 16 }}>
                <label style={labelStyle}>Scan barcode</label>
                <input
                  ref={barcodeInputRef}
                  style={{ ...inputStyle, fontFamily: monoFont, letterSpacing: 0.5 }}
                  placeholder="Scan a case UPC or internal code…"
                  value={barcodeForm.code}
                  onChange={(e) => handleBarcodeChange(e.target.value)}
                  autoFocus
                />
                {barcodeForm.mode === "upc" && (
                  <div style={{ fontSize: 12.5, color: recognizedFlavorName ? SAGE : BERRY, marginTop: 6 }}>
                    {recognizedFlavorName ? `Recognized: ${recognizedFlavorName}` : "UPC not recognized — link it to a flavor in the Add Flavor tab."}
                  </div>
                )}
                {!barcodeForm.mode && barcodeForm.code && (
                  <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>Keep scanning…</div>
                )}
              </div>

              {barcodeForm.mode === "upc" && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Lot #</label>
                  <input
                    style={inputStyle}
                    value={barcodeForm.lot}
                    onChange={(e) => {
                      setLotManuallyEdited(true);
                      setBarcodeForm({ ...barcodeForm, lot: e.target.value });
                    }}
                    onKeyDown={(e) => e.key === "Enter" && submitInbound()}
                  />
                </div>
              )}

              {barcodeForm.mode === "internal" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                    <div>
                      <label style={labelStyle}>Flavor (select manually for now)</label>
                      <select
                        style={inputStyle}
                        value={barcodeForm.flavor_id}
                        onChange={(e) => setBarcodeForm({ ...barcodeForm, flavor_id: e.target.value })}
                      >
                        <option value="">Select…</option>
                        {flavors.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Cases received</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => setBarcodeForm((p) => ({ ...p, cases: String(Math.max(1, Number(p.cases || 1) - 1)) }))}
                          style={stepperBtnStyle}
                        >
                          <Minus size={14} />
                        </button>
                        <input
                          style={{ ...inputStyle, textAlign: "center" }}
                          type="number"
                          min="1"
                          value={barcodeForm.cases}
                          onChange={(e) => setBarcodeForm({ ...barcodeForm, cases: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => setBarcodeForm((p) => ({ ...p, cases: String(Number(p.cases || 1) + 1) }))}
                          style={stepperBtnStyle}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>Lot # (from last 4 characters of the scanned code)</label>
                    <input
                      style={inputStyle}
                      value={barcodeForm.lot}
                      onChange={(e) => {
                        setLotManuallyEdited(true);
                        setBarcodeForm({ ...barcodeForm, lot: e.target.value });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && submitInbound()}
                    />
                  </div>
                </>
              )}

              <SubmitButton submitting={submitting} label="Log received stock" onClick={submitInbound} />
            </div>
          )}

          {/* Outbound form */}
          {tab === "out" && (
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20, marginBottom: 28 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Flavor</label>
                  <select style={inputStyle} value={outForm.flavor_id} onChange={(e) => setOutForm({ ...outForm, flavor_id: e.target.value })}>
                    <option value="">Select…</option>
                    {flavors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Units sold</label>
                  <input style={inputStyle} type="number" min="1" value={outForm.units} onChange={(e) => setOutForm({ ...outForm, units: e.target.value })} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>ShipStation order #</label>
                  <input style={inputStyle} value={outForm.order} onChange={(e) => setOutForm({ ...outForm, order: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Sale date</label>
                  <input style={inputStyle} type="date" value={outForm.date} onChange={(e) => setOutForm({ ...outForm, date: e.target.value })} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Item name from ShipStation (optional)</label>
                <input style={inputStyle} value={outForm.item} onChange={(e) => setOutForm({ ...outForm, item: e.target.value })} />
              </div>
              <SubmitButton submitting={submitting} label="Log sale" onClick={submitOutbound} />
            </div>
          )}

          {/* Add flavor + UPC linking */}
          {tab === "flavor" && (
            <>
              <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20, marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <div>
                    <label style={labelStyle}>Flavor name</label>
                    <input style={inputStyle} value={flavorForm.name} onChange={(e) => setFlavorForm({ ...flavorForm, name: e.target.value })} placeholder="e.g. Pistachio" />
                  </div>
                  <div>
                    <label style={labelStyle}>Units per case</label>
                    <input style={inputStyle} type="number" min="1" value={flavorForm.unitsPerCase} onChange={(e) => setFlavorForm({ ...flavorForm, unitsPerCase: e.target.value })} />
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>SKU (optional)</label>
                  <input style={inputStyle} value={flavorForm.sku} onChange={(e) => setFlavorForm({ ...flavorForm, sku: e.target.value })} />
                </div>
                <SubmitButton submitting={submitting} label="Add flavor" onClick={submitFlavor} />
              </div>

              <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20, marginBottom: 28 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Link a UPC to a flavor</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                  <div>
                    <label style={labelStyle}>Flavor</label>
                    <select style={inputStyle} value={upcLinkForm.flavor_id} onChange={(e) => setUpcLinkForm({ ...upcLinkForm, flavor_id: e.target.value })}>
                      <option value="">Select…</option>
                      {flavors.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>UPC (12 digits)</label>
                    <input
                      style={{ ...inputStyle, fontFamily: monoFont }}
                      value={upcLinkForm.upc}
                      onChange={(e) => setUpcLinkForm({ ...upcLinkForm, upc: e.target.value })}
                      placeholder="851091004046"
                    />
                  </div>
                </div>
                <SubmitButton submitting={submitting} label="Link UPC" onClick={submitUpcLink} />

                {upcCodes.length > 0 && (
                  <div style={{ marginTop: 18, borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
                    <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 8 }}>Linked so far</div>
                    {upcCodes.map((u) => (
                      <div key={u.upc} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
                        <span style={{ fontFamily: monoFont }}>{u.upc}</span>
                        <span style={{ color: MUTED }}>{flavors.find((f) => f.id === u.flavor_id)?.name || "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Current stock */}
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>Current stock</div>
            {dataLoading ? (
              <div style={{ fontSize: 13, color: MUTED, display: "flex", alignItems: "center", gap: 7 }}>
                <Loader2 size={14} className="animate-spin" /> Refreshing…
              </div>
            ) : inventory.length === 0 ? (
              <div style={{ fontSize: 13, color: MUTED }}>No flavors yet — add one above to get started.</div>
            ) : (
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", padding: "9px 14px", fontSize: 11.5, color: MUTED, borderBottom: `1px solid ${BORDER}`, background: "#FBF8F3" }}>
                  <div>Flavor</div>
                  <div>Received</div>
                  <div>Sold</div>
                  <div>On hand</div>
                </div>
                {inventory.map((row, i) => (
                  <div
                    key={row.flavor_id}
                    className="duv-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
                      padding: "11px 14px",
                      fontSize: 13.5,
                      borderBottom: i < inventory.length - 1 ? `1px solid ${BORDER}` : "none",
                    }}
                  >
                    <div>{row.name}</div>
                    <div style={{ color: MUTED }}>{row.units_received}</div>
                    <div style={{ color: MUTED }}>{row.units_sold}</div>
                    <div style={{ fontWeight: 600, color: row.units_on_hand < 0 ? BERRY : INK }}>{row.units_on_hand}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.type === "ok" ? SAGE : BERRY,
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 7,
            fontSize: 13.5,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
          }}
        >
          {toast.type === "ok" ? <Check size={15} /> : <AlertCircle size={15} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

function SubmitButton({ submitting, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      style={{
        background: submitting ? "#C88599" : "#A8365A",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        padding: "10px 20px",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: submitting ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {submitting && <Loader2 size={14} className="animate-spin" />}
      {label}
    </button>
  );
}
