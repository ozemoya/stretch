"use client";

import { useEffect, useState } from "react";
import SketchIcon, { type SketchIconName } from "./SketchIcon";
import { genericImage, type ProductImageMetadata } from "@/lib/product-image";

function categoryIcon(name: string): SketchIconName {
  if (/milk|cream|yogurt|cheese/i.test(name)) return "milk";
  if (/egg/i.test(name)) return "eggs";
  if (/bread|bagel|bun/i.test(name)) return "bread";
  if (/fruit|apple|banana|berry|vegetable|tomato|lettuce|potato/i.test(name)) return "produce";
  return "bag";
}

export default function ProductImage({ name, brand, size, upc, retailerImageUrl, retailerSourceUrl,
  className }: { name: string; brand?: string; size?: string; upc?: string;
  retailerImageUrl?: string; retailerSourceUrl?: string; className?: string }) {
  const [retailerFailed, setRetailerFailed] = useState(false);
  const [image, setImage] = useState<ProductImageMetadata | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lookingUp, setLookingUp] = useState(!retailerImageUrl);
  useEffect(() => {
    if (retailerImageUrl && !retailerFailed) return;
    const controller = new AbortController();
    setLookingUp(true);
    void fetch("/api/product-image", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: name, brand: brand || undefined, size: size || undefined,
        upc: upc && /^\d{8,14}$/.test(upc) ? upc : undefined }), signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<ProductImageMetadata> : genericImage())
      .then((value) => { if (!controller.signal.aborted) { setImage(value); setLoaded(false); } })
      .catch(() => { if (!controller.signal.aborted) setImage(genericImage()); })
      .finally(() => { if (!controller.signal.aborted) setLookingUp(false); });
    return () => controller.abort();
  }, [name, brand, size, upc, retailerImageUrl, retailerFailed]);

  const showingRetailer = !!retailerImageUrl && !retailerFailed;
  const imageUrl = showingRetailer ? retailerImageUrl : image?.imageUrl;
  const imageType = showingRetailer ? "retailer" : image?.imageType ?? "generic_illustration";
  const reference = imageType === "licensed_reference" || imageType === "manufacturer";
  const label = reference ? "Reference image" : imageType === "generic_illustration" ? "Generic product illustration" : "Retailer image";
  const sourceUrl = showingRetailer ? retailerSourceUrl : image?.imageSourceUrl;
  return <div className={`product-image-frame ${className ?? ""}`}>
    <div className="product-image-art">
      {imageUrl ? <>
        {!loaded && <span className="product-image-skeleton" role="status" aria-label="Loading product image" />}
        <img src={imageUrl} alt={reference ? `Reference photo for ${name}` : name} loading="lazy"
          referrerPolicy="no-referrer" onLoad={() => setLoaded(true)}
          onError={() => { if (showingRetailer) setRetailerFailed(true); else setImage(genericImage()); }} />
      </> : lookingUp ? <span className="product-image-skeleton" role="status" aria-label="Finding product image" />
        : <SketchIcon name={categoryIcon(name)} size={58} label={`Illustration of ${name}`} />}
    </div>
    {!showingRetailer && !lookingUp && <span className="product-image-label"
      title="Image for illustration purposes only. Actual product packaging and appearance may vary."
      aria-label={`${label}. Image for illustration purposes only. Actual product packaging and appearance may vary.`}>{label}</span>}
    {sourceUrl && !lookingUp && <a className="product-image-credit" href={sourceUrl} target="_blank" rel="noreferrer"
      title={image?.imageAttribution ?? (showingRetailer ? "Image from retailer listing" : "Image source")}>{showingRetailer ? "Retailer source" : image?.imageSource === "Open Food Facts" ? "Open Food Facts · CC BY-SA" : image?.imageSource ?? "Image source"} ↗</a>}
  </div>;
}
