/**
 * The operator of ichiba and its requisites, for the footer, /contacts, /terms and /privacy. Kept in code, not in
 * hosting settings: the documents that cite them change together with them, in git. The e-mail can still be
 * overridden with NEXT_PUBLIC_LEGAL_EMAIL.
 */
const env = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Legal address, in parts for schema.org PostalAddress (app/contacts). */
const ADDRESS = {
  postalCode: "220100",
  country: "Республика Беларусь",
  locality: "Минск",
  street: "ул. Веры Хоружей, 6А, офис 4А",
};

/** A phone number as shown, with its tel: link. */
const phone = (shown: string) => ({ shown, href: `tel:${shown.replace(/[^\d+]/g, "")}` });

export const LEGAL = {
  /** The company that runs the site (Закон № 99-З requires the operator of personal data to be named). */
  operator: "ООО «Диоксоид Диджитал»",
  operatorFull: "Общество с ограниченной ответственностью «Диоксоид Диджитал»",
  /** In Belarus the registration number in the ЕГР and the УНП are one number. */
  unp: "193959903",
  registered: { shown: "28 января 2026 г.", iso: "2026-01-28" },
  addressParts: ADDRESS,
  address: `${ADDRESS.postalCode}, ${ADDRESS.country}, г. ${ADDRESS.locality}, ${ADDRESS.street}`,
  email: env(process.env.NEXT_PUBLIC_LEGAL_EMAIL) ?? "c4erkaoui@gmail.com",
  phone: phone("+375 29 155-50-74"),
  /** Who takes buyers' complaints (Правила дистанционной торговли, пост. СМ № 31, п. 14.1). */
  complaintsPhone: phone("+375 29 113-23-25"),
  hours: { shown: "пн–пт 10:00–18:00", schema: "Mo-Fr 10:00-18:00" },
  /**
   * The local authority where the company is registered that takes citizens' complaints about trade (п. 14.1 of the
   * same rules): the Soviet district of Minsk, ul. Very Khoruzhey. Numbers from sov.minsk.gov.by (November 2026).
   */
  authority: { name: "отдел торговли и услуг администрации Советского района г. Минска", phones: [phone("+375 17 377-13-93"), phone("+375 17 318-13-33")] },
  /** Must match PRIVACY_VERSION in server/src/auth/auth.service.ts. */
  version: "2026-11-05",
  updated: "9 ноября 2026 г.",
};

export type Phone = (typeof LEGAL)["phone"];

/** "ООО «…», УНП …, юридический адрес: …" — the operator as the documents name it. */
export function operatorLine() {
  return `${LEGAL.operator}, УНП ${LEGAL.unp}, юридический адрес: ${LEGAL.address}`;
}
