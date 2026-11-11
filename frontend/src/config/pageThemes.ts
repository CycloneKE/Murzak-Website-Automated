// One visual theme per landing page: the hero photograph, how it is treated,
// and the accent colour the rest of the page picks up.
//
// To retheme a page, change its entry here. To swap a photo, drop a landscape
// image (about 1920px wide, WebP) in public/images and point `image` at it.

export type PageTone =
  /** The photo keeps its own colours under a dark wash. For images that already suit the page. */
  | "natural"
  /** The photo is drained to greys and re-coloured with the accent. Unifies mixed stock photography. */
  | "duotone";

export interface PageTheme {
  image: string;
  /** Accent used for the hero rule, section markers, prices and links on this page. */
  accent: string;
  tone: PageTone;
  /** CSS object-position for the photo, so the subject stays in frame at every width. */
  position?: string;
}

export const PAGE_THEMES = {
  // Nairobi at midday: the one photo that says where we are. Warm, like the light in it.
  home: { image: "/images/nairobi-skyline.webp", accent: "#f6a93b", tone: "natural", position: "50% 62%" },
  about: { image: "/images/nairobi-skyline.webp", accent: "#a78bfa", tone: "duotone", position: "20% 70%" },
  products: { image: "/images/home-section-bg.webp", accent: "#818cf8", tone: "duotone", position: "50% 50%" },
  pricing: { image: "/images/pricing-section-bg.webp", accent: "#c084fc", tone: "natural", position: "30% 50%" },

  // Business systems
  pos: { image: "/images/for-retail-bg.webp", accent: "#fb923c", tone: "natural", position: "40% 60%" },
  erp: { image: "/images/erp-section-bg.webp", accent: "#38bdf8", tone: "natural", position: "60% 40%" },
  crm: { image: "/images/crm-section-bg.webp", accent: "#fb7185", tone: "duotone", position: "50% 35%" },
  custom: { image: "/images/custom-software-hero.webp", accent: "#e879f9", tone: "natural", position: "40% 30%" },

  // Murzak Cloud
  cloud: { image: "/images/server-glow.webp", accent: "#22d3ee", tone: "natural", position: "70% 50%" },
  databases: { image: "/images/data-center.webp", accent: "#fb923c", tone: "natural", position: "60% 45%" },
  websites: { image: "/images/about-section-bg.webp", accent: "#34d399", tone: "duotone", position: "50% 50%" },
  automation: { image: "/images/products-section-bg.webp", accent: "#a3e635", tone: "natural", position: "40% 50%" },
  email: { image: "/images/hero-maze.webp", accent: "#fbbf24", tone: "duotone", position: "50% 50%" },
  domains: { image: "/images/hero-mesh.webp", accent: "#2dd4bf", tone: "duotone", position: "50% 100%" },

  // Industries
  retail: { image: "/images/for-retail-bg.webp", accent: "#fb923c", tone: "duotone", position: "40% 60%" },
  clinics: { image: "/images/hero-workspace.webp", accent: "#2dd4bf", tone: "duotone", position: "40% 50%" },
  logistics: { image: "/images/hero-ship.webp", accent: "#22d3ee", tone: "natural", position: "50% 45%" },
  services: { image: "/images/for-services-bg.webp", accent: "#93c5fd", tone: "duotone", position: "40% 30%" },
} satisfies Record<string, PageTheme>;

export type PageThemeKey = keyof typeof PAGE_THEMES;
