import type { MetadataRoute } from "next";

/** «Add to home screen»: ichiba opens like an app, in the paper colours of the site. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ichiba — вещи из открытых гардеробов",
    short_name: "ichiba",
    description: "Маркетплейс одежды, обуви и аксессуаров из гардеробов людей и от брендов Беларуси.",
    lang: "ru",
    start_url: "/",
    display: "standalone",
    background_color: "#f4efe6",
    theme_color: "#f4efe6",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
