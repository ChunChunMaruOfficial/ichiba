import { DELIVERY_LABEL } from "@/lib/labels";
import type { DeliveryMethod } from "@/lib/types";
import { IconTruck } from "./ui";

/** A way of handing an item over, as words; delivery gets a small truck before it. */
export function DeliveryLabel({ method }: { method: DeliveryMethod }) {
  if (method !== "DELIVERY") return <>{DELIVERY_LABEL[method]}</>;
  return (
    <span className="inline-flex items-center gap-1 align-[-0.15em]">
      <IconTruck className="size-[1.15em] shrink-0" />
      {DELIVERY_LABEL[method]}
    </span>
  );
}
