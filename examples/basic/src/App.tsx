const ITEMS = [
  { name: 'Wireless keyboard', price: '$79.00' },
  { name: 'USB-C cable', price: '$19.00' },
  { name: 'Laptop stand', price: '$50.00' },
]

export function App() {
  return (
    <div className="page">
      <PromoBanner />
      <div className="cols">
        <PaymentPanel />
        <OrderSummary />
      </div>
      <p className="foot">
        Demo app for feedbasha — click the mic (bottom-right), then talk while clicking components.
      </p>
    </div>
  )
}

function PromoBanner() {
  return (
    <div className="promo" data-testid="promo">
      <span>🎉 20% off everything this weekend, no code needed</span>
      <small>ends Sunday</small>
    </div>
  )
}

function PaymentPanel() {
  return (
    <section className="card">
      <h3>Payment details</h3>
      <Field label="Card number" />
      <div className="row2">
        <Field label="Expiry" />
        <Field label="CVC" />
      </div>
      <Field label="Name on card" />
    </section>
  )
}

function Field({ label }: { label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" />
    </label>
  )
}

function OrderSummary() {
  return (
    <section className="card summary" data-testid="order-summary">
      <h3>
        Order summary <span className="muted">{ITEMS.length} items</span>
      </h3>
      <ul className="items">
        {ITEMS.map((it) => (
          <LineItem key={it.name} name={it.name} price={it.price} />
        ))}
      </ul>
      <div className="total">
        <span>Total</span>
        <span>$148.00</span>
      </div>
      <SubmitButton />
    </section>
  )
}

function LineItem({ name, price }: { name: string; price: string }) {
  return (
    <li className="line-item">
      <span>{name}</span>
      <span className="price">{price}</span>
    </li>
  )
}

function SubmitButton() {
  return (
    <button className="btn" data-testid="place-order">
      Place order
    </button>
  )
}
