"use client";

import clsx from "clsx";
import { useState } from "react";
import { Button, IconBag, IconCheck } from "./ui";

/**
 * «Купить» and «В корзину» on the item page, one width, each with its icon. Small, quiet motions (buy-buttons in
 * globals.css): «Купить»'s arrow leans forward on hover and darts off on a press; adding to the cart drops a small
 * parcel into the bag, which gives a little under its weight. Reduced motion keeps them still.
 */

const IconArrow = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
  </svg>
);

export function BuyButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  // Keyed on each press: the dart plays again every time.
  const [press, setPress] = useState(0);
  return (
    <Button
      size="lg"
      className="buy-btn w-full"
      disabled={disabled}
      onClick={() => {
        setPress((n) => n + 1);
        onClick();
      }}
    >
      Купить
      <span className="relative inline-flex size-5 overflow-hidden">
        <IconArrow key={press} className={press ? "buy-arrow buy-dart size-5" : "buy-arrow size-5"} />
      </span>
    </Button>
  );
}

export function CartButton({ inCart, onClick }: { inCart: boolean; onClick: () => void }) {
  // Counts the times the item went into the cart (not the presses: one may stop at «pick a size»); each drops the
  // parcel again, taking it out doesn't.
  // Only after a press here: the viewer's own copy of the listing arriving with the item already in the cart drops nothing.
  const [adds, setAdds] = useState(0);
  const [armed, setArmed] = useState(false);
  const [was, setWas] = useState(inCart);
  if (was !== inCart) {
    setWas(inCart);
    if (inCart && armed) setAdds((n) => n + 1);
    setArmed(false);
  }
  return (
    <Button
      size="lg"
      variant="secondary"
      className="w-full"
      onClick={() => {
        setArmed(!inCart);
        onClick();
      }}
      aria-pressed={inCart}
      title={inCart ? "Убрать из корзины" : undefined}
    >
      <span key={adds} className={clsx("cart-bag relative inline-flex size-5", adds > 0 && "cart-drop", inCart && "mr-1.5")}>
        <span className="cart-parcel" aria-hidden />
        <IconBag className="size-5" />
        {inCart && (
          <span className="absolute -bottom-1 -right-1.5 grid size-3.5 place-items-center rounded-full bg-ink text-accent-ink">
            <IconCheck className="size-2.5" />
          </span>
        )}
      </span>
      {inCart ? "В корзине" : "В корзину"}
    </Button>
  );
}
