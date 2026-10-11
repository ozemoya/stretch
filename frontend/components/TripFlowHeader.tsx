import Link from "next/link";

export default function TripFlowHeader({ step }: { step: 1 | 2 | 3 }) {
  return (
    <>
      <a className="skip" href={step === 1 ? "#planner" : step === 2 ? "#results-main" : "#checkout-main"}>
        Skip to current step
      </a>
      <header className="trip-header">
        <Link href="/" aria-label="Stretch home">
          <img className="logo" src="/assets/stretch-logo-transparent.png" alt="Stretch" />
        </Link>
        <Link className="trip-home-link" href="/">
          ← Back to home
        </Link>
      </header>
      <nav className="trip-progress" aria-label="Trip planning steps">
        <ol>
          <li className={step === 1 ? "current" : "complete"}>
            <Link href="/plan" aria-current={step === 1 ? "step" : undefined}>
              <b>{step > 1 ? "✓" : "1"}</b>
              <span>
                Your food list<small>Food, budget & starting area</small>
              </span>
            </Link>
          </li>
          <li className={step === 2 ? "current" : step === 3 ? "complete" : "upcoming"}>
            {step === 3 ? <Link href="/plan/results"><b>✓</b><span>Stores & gas<small>Compare prices & plan your route</small></span></Link> : <span aria-current={step === 2 ? "step" : undefined}>
              <b>2</b>
              <span>
                Stores & gas<small>Compare prices & plan your route</small>
              </span>
            </span>}
          </li>
          <li className={step === 3 ? "current" : "upcoming"}>
            <span aria-current={step === 3 ? "step" : undefined}>
              <b>3</b>
              <span>Trip review<small>Food + gas total</small></span>
            </span>
          </li>
        </ol>
      </nav>
    </>
  );
}
