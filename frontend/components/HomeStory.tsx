import Link from "next/link";
import SketchIcon from "./SketchIcon";

export default function HomeStory() {
  return (
    <div className="home-story">
      <section className="story-intro" id="how-stretch-works">
        <div className="story-kicker"><span>01 / THE IDEA</span><span>YOUR LIST → YOUR ROUTE</span></div>
        <div className="story-intro-grid">
          <div>
            <p className="eyebrow">HOW STRETCH WORKS</p>
            <h2>Groceries are only half the trip.</h2>
          </div>
          <p>Stretch compares what’s on your list with the drive to get it. Pick the store and gas stop that make sense for you.</p>
        </div>
        <div className="story-steps">
          <article><SketchIcon name="bag" size={92} /><span className="story-step-number">01</span><h3>Make your list</h3><p>Search for food and set your starting area.</p></article>
          <article><SketchIcon name="tag" size={92} /><span className="story-step-number">02</span><h3>Compare stores</h3><p>See prices, package sizes, and what’s missing.</p></article>
          <article><SketchIcon name="car" size={92} /><span className="story-step-number">03</span><h3>Check the drive</h3><p>Choose a gas stop and review the total trip cost.</p></article>
        </div>
      </section>

      <section className="story-comparison" id="compare-stores">
        <div className="story-comparison-copy">
          <p className="eyebrow">02 / COMPARE NEARBY STORES</p>
          <h2>That cheaper shelf price? Check the drive.</h2>
          <p>The best route depends on your list, your car, and how many stops you’re willing to make.</p>
          <Link className="story-text-link" href="/plan">Compare your own list <span aria-hidden="true">↗</span></Link>
          <SketchIcon name="arrow" size={100} className="story-arrow" />
        </div>
        <div className="story-receipt" aria-label="Sample grocery trip comparison">
          <div className="receipt-head"><span>STRETCH / SAMPLE MATH</span><SketchIcon name="cart" size={56} /></div>
          <h3>Worth the drive?</h3>
          <div className="receipt-row"><span>Market A</span><span>$52 food + $3 driving</span><strong>$55</strong></div>
          <div className="receipt-row"><span>Market B</span><span>$47 food + $9 driving</span><strong>$56</strong></div>
          <div className="receipt-row receipt-best"><span>Two stores</span><span>$43 food + $5 driving</span><strong>$48</strong></div>
          <p className="receipt-note">Sample prices. Your comparison uses available sourced prices and your route.</p>
          <SketchIcon name="star" size={64} className="receipt-star" />
        </div>
      </section>

      <section className="story-source" id="price-sources">
        <div className="source-art" aria-hidden="true">
          <SketchIcon name="milk" size={108} className="source-milk" />
          <SketchIcon name="eggs" size={112} className="source-eggs" />
          <SketchIcon name="bread" size={100} className="source-bread" />
          <SketchIcon name="produce" size={116} className="source-produce" />
          <span className="source-art-note">same list.<br />different shelves.</span>
        </div>
        <div className="source-copy">
          <p className="eyebrow">03 / STRETCH AI &amp; PRICE SOURCES</p>
          <h2>Find the right item. Know where the price came from.</h2>
          <p>Stretch helps match names, brands, and package sizes across available catalogs. A price appears with its source and date; an online price is labeled when it hasn’t been confirmed at that branch.</p>
          <div className="source-stamps"><span><SketchIcon name="badge" size={30} /> Source shown</span><span><SketchIcon name="tag" size={30} /> Package checked</span></div>
          <Link className="story-text-link" href="/plan">Search groceries <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <section className="story-ending">
        <SketchIcon name="map" size={116} className="ending-map" />
        <p className="eyebrow">04 / YOUR NEXT TRIP</p>
        <h2>Bring home more than groceries.</h2>
        <p>Build a list to see the stores and gas stops available near you. Your recent trip reviews will appear on your dashboard.</p>
        <Link className="story-end-button" href="/dashboard">Start Here! <span aria-hidden="true">↗</span></Link>
        <SketchIcon name="coin" size={86} className="ending-coin" />
      </section>
    </div>
  );
}
