import { useRef, useState, type ReactNode } from "react";
import type { DealQuoteDocument, ScoredVehicle } from "../types";
import {
  activeQuotes,
  money,
  resolveFinance,
  type FinanceSettings,
  type PurchaseSelection,
} from "../domain/finance";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
type Mode = "Simple" | "Realistic" | "Ownership";
export interface PurchaseScenario {
  id: string;
  name: string;
  vehicleId: string;
  selection: PurchaseSelection;
  settings: FinanceSettings;
  savedAt: string;
}
export function PaymentCalculator({
  vehicle,
  vehicles,
  quotes,
  settings,
  onSettingsChange,
  selection,
  onSelectionChange,
  onVehicleChange,
  budgetLimit,
  onBudgetLimitChange,
}: {
  vehicle: ScoredVehicle;
  vehicles: ScoredVehicle[];
  quotes: DealQuoteDocument[];
  settings: FinanceSettings;
  onSettingsChange: (s: FinanceSettings) => void;
  selection: PurchaseSelection;
  onSelectionChange: (s: PurchaseSelection, vehicleId?: string) => void;
  onVehicleChange: (id: string) => void;
  budgetLimit: number;
  onBudgetLimitChange: (n: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("Simple");
  const [scenarios, setScenarios, scenarioStorageError] = useLocalStorageState<
    PurchaseScenario[]
  >("carmatch.purchaseScenarios", []);
  const [name, setName] = useState(""),
    [message, setMessage] = useState("");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const result = resolveFinance(vehicle, quotes, settings, selection);
  const offers = activeQuotes(quotes, vehicle.id);
  const set = (key: keyof FinanceSettings, n: number) =>
    onSettingsChange({
      ...settings,
      [key]: Math.max(key === "termMonths" ? 1 : 0, n),
    });
  const field = (
    key: keyof FinanceSettings,
    label: string,
    tip: string,
    step = "1",
  ) => (
    <Field label={label} tip={tip}>
      <input
        type="number"
        min={key === "termMonths" ? 1 : 0}
        step={step}
        value={settings[key]}
        onChange={(e) => set(key, +e.target.value)}
      />
    </Field>
  );
  function custom(key: keyof PurchaseSelection, value: number) {
    onSelectionChange({
      source: "custom",
      price: result.price,
      fees: result.fees,
      discount: result.discount,
      accessories: result.accessories,
      tradeIn: result.tradeIn,
      consumption: selection.consumption,
      [key]: value,
    });
  }
  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Purchase scenarios</p>
        <h2>What will it really cost?</h2>
        <p className="muted">
          Household assumptions and each vehicle’s selected offer update prices
          and total monthly budgets throughout CarMatch. Saved scenarios stay on
          this device.
        </p>
      </div>
      <label>
        Vehicle
        <select
          value={vehicle.id}
          onChange={(e) => onVehicleChange(e.target.value)}
        >
          {vehicles.map((v) => (
            <option value={v.id} key={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Price source
        <select
          value={
            selection.source === "trim" || selection.source === "quote"
              ? `${selection.source}:${selection.sourceId}`
              : selection.source
          }
          onChange={(e) => {
            const [source, ...id] = e.target.value.split(":");
            onSelectionChange({
              source: source as PurchaseSelection["source"],
              ...(id.length ? { sourceId: id.join(":") } : {}),
            });
          }}
        >
          <option value="auto">Lowest active quote, otherwise MSRP</option>
          <option value="msrp">MSRP estimate</option>
          {vehicle.trimOptions?.map((t) => (
            <option key={t.name} value={`trim:${t.name}`}>
              {t.name} · {money(t.price)} (catalogue estimate)
            </option>
          ))}
          {offers.map((q) => (
            <option key={q.id} value={`quote:${q.id}`}>
              {q.dealer} · {q.trim || "Quote"}
            </option>
          ))}
          {selection.source === "quote" &&
            !offers.some((q) => q.id === selection.sourceId) && (
              <option value={`quote:${selection.sourceId}`}>
                Selected quote unavailable — using MSRP estimate
              </option>
            )}
          <option value="custom">Custom price</option>
        </select>
      </label>
      <div className="mode-tabs" role="tablist" aria-label="Calculator detail">
        {(["Simple", "Realistic", "Ownership"] as Mode[]).map((m, i) => (
          <button
            key={m}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`mode-${m}`}
            type="button"
            role="tab"
            aria-selected={mode === m}
            aria-controls="calculator-panel"
            tabIndex={mode === m ? 0 : -1}
            className={mode === m ? "active" : ""}
            onClick={() => setMode(m)}
            onKeyDown={(e) => {
              const modes: Mode[] = ["Simple", "Realistic", "Ownership"];
              const next =
                e.key === "ArrowRight"
                  ? (i + 1) % 3
                  : e.key === "ArrowLeft"
                    ? (i + 2) % 3
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 2
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                setMode(modes[next]);
                tabs.current[next]?.focus();
              }
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <div
        id="calculator-panel"
        role="tabpanel"
        aria-labelledby={`mode-${mode}`}
        className="calculator-grid"
      >
        <Field
          label="Vehicle price before tax & fees"
          tip="Editing creates a custom estimate. Fees and tax are added once below."
        >
          <input
            min="0"
            type="number"
            value={result.price}
            onChange={(e) => custom("price", +e.target.value)}
          />
        </Field>
        {field(
          "downPayment",
          "Cash down payment",
          "Cash paid up front, separate from trade-in.",
        )}
        {field(
          "rate",
          "Finance APR %",
          "Shared comparison rate. Offered rates stay in Deal tracker.",
          "0.01",
        )}
        {field(
          "termMonths",
          "Loan term (months)",
          "Used consistently for every vehicle.",
        )}
        {mode !== "Simple" && (
          <>
            {(["fees", "discount", "accessories", "tradeIn"] as const).map(
              (key) => (
                <Field
                  key={key}
                  label={
                    {
                      fees: "Fees / freight / PDI",
                      discount: "Discount",
                      accessories: "Accessories",
                      tradeIn: "Dealer trade-in credit",
                    }[key]
                  }
                  tip="Editing creates a custom offer while keeping other amounts."
                >
                  <input
                    type="number"
                    min="0"
                    value={result[key]}
                    onChange={(e) => custom(key, +e.target.value)}
                  />
                </Field>
              ),
            )}
            {field(
              "taxRate",
              "Sales tax %",
              "Assumes Ontario-style dealer trade-in tax credit. Confirm your province and quote.",
              "0.01",
            )}
          </>
        )}
        {mode === "Ownership" && (
          <>
            {field(
              "insurance",
              "Insurance / month",
              "Your own insurance estimate.",
            )}
            {field(
              "maintenance",
              "Maintenance / month",
              "Servicing, tires and repair reserve.",
            )}
            {field(
              "annualKm",
              "Annual kilometres",
              "Used to estimate monthly energy costs.",
            )}
            {field(
              "fuelPrice",
              "Fuel $ / litre",
              "Planning price, not a live fuel quote.",
              "0.01",
            )}
            {field(
              "electricityPrice",
              "Electricity $ / kWh",
              "For electric vehicles.",
              "0.01",
            )}
            <Field
              label={
                vehicle.powertrain === "Electric"
                  ? "Consumption kWh / 100 km"
                  : "Consumption L / 100 km"
              }
              tip="Default is a catalogue value when available, otherwise a rough powertrain estimate. PHEVs default to gasoline operation; enter your effective fuel use."
            >
              <input
                type="number"
                min="0"
                step="0.1"
                value={
                  selection.consumption ??
                  (vehicle.powertrain === "Electric"
                    ? 20
                    : Number(
                        vehicle.fuelEfficiency.match(
                          /(\d+(?:\.\d+)?)\s*L\//,
                        )?.[1],
                      ) || (vehicle.powertrain.includes("Hybrid") ? 6.5 : 9))
                }
                onChange={(e) =>
                  onSelectionChange({
                    ...selection,
                    consumption: +e.target.value,
                  })
                }
              />
            </Field>
            <label>
              Max total ownership / month
              <input
                type="number"
                min="0"
                value={budgetLimit}
                onChange={(e) =>
                  onBudgetLimitChange(Math.max(0, +e.target.value))
                }
              />
            </label>
          </>
        )}
      </div>
      {selection.source === "quote" &&
        offers.find((q) => q.id === selection.sourceId) && (
          <button
            onClick={() =>
              set(
                "rate",
                offers.find((q) => q.id === selection.sourceId)!.financeRate,
              )
            }
          >
            Use this quote’s offered APR
          </button>
        )}
      <div className="payment-result" aria-live="polite">
        <strong>{money(result.ownership)} / month</strong>
        <span>
          Total ownership ·{" "}
          {budgetLimit
            ? result.ownership <= budgetLimit
              ? "Within budget"
              : "Over budget"
            : "No budget set"}
        </span>
        <small>
          Loan {money(result.payment)} + energy {money(result.energy)} +
          insurance {money(settings.insurance)} + maintenance{" "}
          {money(settings.maintenance)}
        </small>
      </div>
      <details>
        <summary>Price breakdown & assumptions</summary>
        <dl className="finance-breakdown">
          {Object.entries({
            "Vehicle price": result.price,
            Fees: result.fees,
            Accessories: result.accessories,
            Discount: -result.discount,
            "Sales tax": result.tax,
            "Out-the-door before trade-in": result.outTheDoor,
            "Trade-in": -result.tradeIn,
            "Cash down": -settings.downPayment,
            "Amount financed": result.principal,
            "Total loan interest": result.interest,
          }).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{money(v)}</dd>
            </div>
          ))}
        </dl>
        <p>
          {result.source}. {settings.rate}% APR over {settings.termMonths}{" "}
          months. Estimates exclude depreciation, parking and registration.
          Confirm taxes and eligibility with your dealer.
        </p>
      </details>
      <form
        className="action-row"
        onSubmit={(e) => {
          e.preventDefault();
          setScenarios([
            ...scenarios,
            {
              id: crypto.randomUUID(),
              name: name.trim() || `${vehicle.name} scenario`,
              vehicleId: vehicle.id,
              selection: {
                source: "custom",
                price: result.price,
                fees: result.fees,
                discount: result.discount,
                accessories: result.accessories,
                tradeIn: result.tradeIn,
                consumption: selection.consumption,
              },
              settings: { ...settings },
              savedAt: new Date().toISOString(),
            },
          ]);
          setName("");
          setMessage("Scenario saved on this device.");
        }}
      >
        <label>
          Scenario name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CR-V dealer offer"
          />
        </label>
        <button>Save scenario</button>
      </form>
      <p role="status">
        {scenarioStorageError ? "Scenario retained in this tab only." : message}
      </p>
      {scenarioStorageError && (
        <p role="alert" className="error-text">
          {scenarioStorageError}
        </p>
      )}
      <div className="scenario-list">
        {scenarios.map((s) => {
          const v = vehicles.find((v) => v.id === s.vehicleId);
          if (!v) return null;
          const r = resolveFinance(v, [], s.settings, s.selection);
          return (
            <article key={s.id}>
              <strong>{s.name}</strong>
              <span>
                {v.name} · {money(r.ownership)}/mo · {money(r.outTheDoor)}{" "}
                out-the-door
              </span>
              <small>
                {s.settings.rate}% · {s.settings.termMonths} months ·{" "}
                {money(s.settings.downPayment)} down ·{" "}
                {s.settings.annualKm.toLocaleString()} km/year
              </small>
              <div className="action-row">
                <button
                  onClick={() => {
                    onVehicleChange(v.id);
                    onSelectionChangeForScenario(s);
                  }}
                >
                  Apply scenario
                </button>
                <button
                  onClick={() =>
                    setScenarios(scenarios.filter((x) => x.id !== s.id))
                  }
                >
                  Remove scenario
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
  function onSelectionChangeForScenario(s: PurchaseScenario) {
    onSettingsChange(s.settings);
    onSelectionChange(s.selection, s.vehicleId);
    setMessage(`Applied ${s.name}.`);
  }
}
function Field({
  label,
  tip,
  children,
}: {
  label: string;
  tip: string;
  children: ReactNode;
}) {
  return (
    <div className="calculator-field">
      <label>
        {label}
        {children}
      </label>
      <details className="field-help">
        <summary>About {label.toLowerCase()}</summary>
        <p>{tip}</p>
      </details>
    </div>
  );
}
