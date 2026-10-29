"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { GA_ID, pageView, readConsent, subscribeConsent, YM_ID } from "@/lib/analytics";

/**
 * Yandex Metrica and Google Analytics, only once the visitor allowed analytics (lib/analytics.ts). Metrica runs with
 * Webvisor and click maps; page views are sent by hand on every navigation, since the app changes pages without
 * reloading.
 */
export function Analytics() {
  const allowed = useSyncExternalStore(subscribeConsent, () => readConsent() === "all", () => false);
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (!allowed) return;
    // The first view is counted by the init calls below; later ones here, after the new page has its title.
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => pageView(location.href), 300);
    return () => clearTimeout(t);
  }, [allowed, pathname]);

  if (!allowed || !(YM_ID || GA_ID)) return null;
  // The script ids must not be «ym» or «gtag»: an element's id is also a global, and window.ym would be the <script>.
  return (
    <>
      {YM_ID && (
        <Script id="ym-init" strategy="afterInteractive">
          {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
ym(${Number(YM_ID)},"init",{ssr:true,webvisor:true,clickmap:true,trackLinks:true,accurateTrackBounce:true});`}
        </Script>
      )}
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config",${JSON.stringify(GA_ID)});`}
          </Script>
        </>
      )}
    </>
  );
}
