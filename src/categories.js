// Fixed category list. Slugs are used in URLs, KV keys and the JSON API.
export const CATEGORIES = [
  { slug: "allgemein", name: "Allgemein", icon: "✦", description: "Alles rund um Lumina, Vorstellungen und allgemeine Diskussionen." },
  { slug: "technik-nexus", name: "Technik & Nexus", icon: "⚙", description: "Code, Server, Nexus, Netzwerke und alles Technische." },
  { slug: "musik", name: "Musik (OUR BAND)", icon: "♫", description: "OUR BAND: neue Songs, Proben, Auftritte und Feedback." },
  { slug: "marktplatz", name: "Marktplatz", icon: "⇄", description: "Biete, suche, tausche. Bitte fair und ehrlich bleiben." },
  { slug: "off-topic", name: "Off-Topic", icon: "☾", description: "Alles, was sonst nirgends reinpasst." },
];

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function getCategory(slug) {
  return BY_SLUG.get(String(slug || "").toLowerCase()) || null;
}
