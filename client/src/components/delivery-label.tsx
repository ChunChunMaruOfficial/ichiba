import { DELIVERY_LABEL } from "@/lib/labels";
import type { DeliveryMethod } from "@/lib/types";
import { IconTruck } from "./ui";

/** A way of handing an item over, as words; delivery gets a small truck before it. */
export function DeliveryLabel({ method }: { method: DeliveryMethod }) {
  if (method !== "DELIVERY") return <>{DELIVERY_LABEL[method]}</>;
  return (
    // Plain inline text with the icon dropped a little below the baseline: an inline-flex box here took its baseline
    // from the icon and lifted the word above the text around it.
    <span className="whitespace-nowrap">
      <IconTruck className="mr-1 inline-block size-[1.15em] align-[-0.22em]" />
      {DELIVERY_LABEL[method]}
    </span>
  );
}
