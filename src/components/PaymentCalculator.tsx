import { useEffect, useState, type ReactNode } from 'react';
import type { ScoredVehicle } from '../types';

type PaymentMode = 'Simple' | 'Realistic' | 'Ownership';

export function PaymentCalculator({ vehicle, budgetLimit, onBudgetLimitChange }: { vehicle: ScoredVehicle; budgetLimit: number; onBudgetLimitChange: (value: number) => void }) {
  const [mode, setMode] = useState<PaymentMode>('Simple');
  const [price, setPrice] = useState(vehicle.msrp);
  const [rate, setRate] = useState(5.99);
  const [termMonths, setTermMonths] = useState(60);
  const [downPayment, setDownPayment] = useState(5000);
  const [extraPrincipal, setExtraPrincipal] = useState(0);
  const [fees, setFees] = useState(2495);
  const [taxRate, setTaxRate] = useState(13);
  const [rebate, setRebate] = useState(0);
  const [insurance, setInsurance] = useState(180);
  const [fuel, setFuel] = useState(160);
  const [maintenance, setMaintenance] = useState(85);

  useEffect(() => setPrice(vehicle.msrp), [vehicle.msrp]);

  const taxAmount = (Math.max(price + fees - rebate, 0) * taxRate) / 100;
  const allInPrice = Math.max(price + fees + taxAmount - rebate, 0);
  const principal = Math.max(allInPrice - downPayment - extraPrincipal, 0);
  const monthlyRate = rate / 100 / 12;
  const safeTermMonths = Math.max(termMonths, 1);
  const payment = monthlyRate === 0 ? principal / safeTermMonths : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -safeTermMonths);
  const totalInterest = Math.max(payment * safeTermMonths - principal, 0);
  const ownershipMonthly = Math.round(payment + insurance + fuel + maintenance);
  const budgetState = budgetLimit === 0 ? 'Set a monthly budget guardrail' : ownershipMonthly <= budgetLimit ? '✅ Within monthly budget' : ownershipMonthly <= budgetLimit * 1.12 ? '⚠️ Budget stretch' : '❌ Over budget';

  return (
    <section className="card stack">
      <div className="section-heading"><p className="eyebrow">Payment calculator</p><span>{vehicle.name}</span></div>
      <div className="mode-tabs" role="tablist" aria-label="Payment calculator mode">
        {(['Simple', 'Realistic', 'Ownership'] as PaymentMode[]).map((option) => <button type="button" className={mode === option ? 'active' : ''} onClick={() => setMode(option)} key={option}>{option}</button>)}
      </div>
      <div className="calculator-grid">
        <Field label="Price" tip="Vehicle selling price before taxes and fees."><input type="number" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></Field>
        <Field label="Down payment" tip="Cash paid up front to reduce the financed principal."><input type="number" value={downPayment} onChange={(event) => setDownPayment(Number(event.target.value))} /></Field>
        <Field label="Interest %" tip="Annual percentage rate for financing."><input type="number" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></Field>
        <Field label="Term months" tip="Loan length in months."><input type="number" value={termMonths} onChange={(event) => setTermMonths(Number(event.target.value))} /></Field>
        {mode !== 'Simple' && <>
          <Field label="Lump principal" tip="Extra principal payment applied immediately after taxes and fees."><input type="number" value={extraPrincipal} onChange={(event) => setExtraPrincipal(Number(event.target.value))} /></Field>
          <Field label="Fees / freight / PDI" tip="Freight, pre-delivery inspection, admin fees, and similar dealer charges."><input type="number" value={fees} onChange={(event) => setFees(Number(event.target.value))} /></Field>
          <Field label="Tax rate %" tip="Local sales tax rate. Ontario HST is commonly 13%."><input type="number" step="0.1" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value))} /></Field>
          <Field label="Rebates / discounts" tip="Manufacturer rebates, dealer discounts, or negotiated reductions."><input type="number" value={rebate} onChange={(event) => setRebate(Number(event.target.value))} /></Field>
        </>}
        {mode === 'Ownership' && <>
          <Field label="Insurance / mo." tip="Estimated monthly insurance cost."><input type="number" value={insurance} onChange={(event) => setInsurance(Number(event.target.value))} /></Field>
          <Field label="Fuel / mo." tip="Estimated monthly fuel or charging cost."><input type="number" value={fuel} onChange={(event) => setFuel(Number(event.target.value))} /></Field>
          <Field label="Maintenance / mo." tip="Tires, servicing, fluids, and maintenance reserve."><input type="number" value={maintenance} onChange={(event) => setMaintenance(Number(event.target.value))} /></Field>
          <Field label="Budget guardrail" tip="Your preferred maximum total monthly ownership cost."><input type="number" value={budgetLimit} onChange={(event) => onBudgetLimitChange(Number(event.target.value))} /></Field>
        </>}
      </div>
      <div className="payment-result"><strong>${Math.round(payment).toLocaleString('en-CA')}</strong><span>/ month financed • {budgetState}</span><small>All-in ${Math.round(allInPrice).toLocaleString('en-CA')} • financed ${Math.round(principal).toLocaleString('en-CA')} • interest ${Math.round(totalInterest).toLocaleString('en-CA')} • ownership estimate ${ownershipMonthly.toLocaleString('en-CA')}/mo</small></div>
      <p className="muted">Start with Simple mode, then move to Realistic or Ownership when you have dealer fees, tax assumptions, insurance, fuel, and maintenance estimates.</p>
    </section>
  );
}

function Field({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  return <label>{label}<span className="info-tip" title={tip} aria-label={tip}>?</span>{children}</label>;
}
