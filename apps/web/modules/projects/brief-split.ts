/**
 * Turns a brief into a proposed crew with a budget split.
 *
 * Templates are built from the disciplines that actually have people behind
 * them in the live pool, weighted by how many talent hold each one.
 *
 * This is deliberately a deterministic rules engine, not a model call. It runs
 * in under a millisecond with no network, which is what lets the crew appear
 * the instant the brand stops typing — no spinner, no request in the
 * interaction path. Swapping in a model later only needs this signature
 * preserved.
 *
 * Percentages are shares of the CREW POOL and always sum to exactly 100, so
 * they can be handed straight to splitPot() in lib/money.ts.
 */

export interface ProposedRole {
  title: string;
  discipline: string;
  /** Share of the crew pool, before normalisation. */
  weight: number;
}

interface Template {
  id: string;
  /** Matched case-insensitively against the brief as whole words. */
  keywords: string[];
  roles: ProposedRole[];
}

const TEMPLATES: Template[] = [
  {
    id: 'film',
    keywords: [
      'film',
      'video',
      'videographer',
      'spot',
      'commercial',
      'advert',
      'ad',
      'reel',
      'trailer',
      'documentary',
      'cinematic',
      'tvc',
      'campaign film',
    ],
    roles: [
      { title: 'Filmmaker', discipline: 'filmmaker', weight: 30 },
      { title: 'Videographer', discipline: 'videographer', weight: 25 },
      { title: 'Video Editor', discipline: 'video-editor', weight: 20 },
      { title: 'Creative Director', discipline: 'creative-director', weight: 15 },
      { title: 'Producer', discipline: 'producer', weight: 10 },
    ],
  },
  {
    id: 'photo',
    keywords: [
      'photo',
      'photography',
      'photographer',
      'shoot',
      'lookbook',
      'editorial',
      'portrait',
      'headshot',
      'product shot',
      'campaign shoot',
    ],
    roles: [
      { title: 'Photographer', discipline: 'photographer', weight: 40 },
      { title: 'Creative Director', discipline: 'creative-director', weight: 20 },
      { title: 'Stylist', discipline: 'stylist', weight: 20 },
      { title: 'Model', discipline: 'model', weight: 20 },
    ],
  },
  {
    id: 'music',
    keywords: [
      'music',
      'song',
      'track',
      'single',
      'album',
      'ep',
      'record',
      'vocal',
      'singer',
      'jingle',
      'anthem',
      'soundtrack',
      'sonic',
    ],
    roles: [
      { title: 'Singer', discipline: 'singer', weight: 35 },
      { title: 'Songwriter', discipline: 'songwriter', weight: 25 },
      { title: 'Musician', discipline: 'musician', weight: 25 },
      { title: 'Producer', discipline: 'producer', weight: 15 },
    ],
  },
  {
    id: 'event',
    keywords: [
      'event',
      'launch',
      'activation',
      'popup',
      'pop-up',
      'party',
      'showcase',
      'exhibition',
      'conference',
      'experience',
      'installation',
      'venue',
    ],
    roles: [
      { title: 'Event Designer', discipline: 'event-designer', weight: 30 },
      { title: 'Event Manager', discipline: 'event-manager', weight: 25 },
      { title: 'Photographer', discipline: 'photographer', weight: 20 },
      { title: 'Content Creator', discipline: 'content-creator', weight: 15 },
      { title: 'Producer', discipline: 'producer', weight: 10 },
    ],
  },
  {
    id: 'content',
    keywords: [
      'content',
      'social',
      'tiktok',
      'instagram',
      'reels',
      'ugc',
      'influencer',
      'creator',
      'vlog',
      'youtube',
      'shorts',
      'posts',
    ],
    roles: [
      { title: 'Content Creator', discipline: 'content-creator', weight: 40 },
      { title: 'Videographer', discipline: 'videographer', weight: 25 },
      { title: 'Social Media Manager', discipline: 'social-media-manager', weight: 20 },
      { title: 'Copywriter', discipline: 'copywriter', weight: 15 },
    ],
  },
  {
    id: 'brand',
    keywords: [
      'brand',
      'branding',
      'identity',
      'logo',
      'rebrand',
      'visual identity',
      'graphic',
      'design system',
      'packaging',
      'merch',
      'apparel',
    ],
    roles: [
      { title: 'Graphic Designer', discipline: 'graphic-designer', weight: 35 },
      { title: 'Art Director', discipline: 'art-director', weight: 25 },
      { title: 'Illustrator', discipline: 'illustrator', weight: 20 },
      { title: 'Brand Strategist', discipline: 'brand-strategist', weight: 20 },
    ],
  },
  {
    // Software and web builds. Added because the seven templates before it were
    // all talent-industry, so "full stack project" matched nothing, fell to
    // FALLBACK, and proposed a Talent Director and a Photographer for a
    // software build. Migration 037 adds the disciplines these point at.
    id: 'software',
    keywords: [
      'software',
      'app',
      'application',
      'platform',
      'saas',
      'api',
      'backend',
      'frontend',
      'full stack',
      'fullstack',
      'full-stack',
      'developer',
      'development',
      'engineer',
      'engineering',
      'mvp',
      'prototype',
      'dashboard',
      'integration',
      'database',
      'mobile app',
      'ios',
      'android',
    ],
    roles: [
      { title: 'Full Stack Developer', discipline: 'full-stack-developer', weight: 35 },
      { title: 'Product Designer', discipline: 'product-designer', weight: 25 },
      { title: 'Backend Developer', discipline: 'backend-developer', weight: 20 },
      { title: 'Product Manager', discipline: 'product-manager', weight: 20 },
    ],
  },
  {
    id: 'web',
    keywords: [
      'website',
      'web',
      'web design',
      'webflow',
      'wordpress',
      'shopify',
      'ecommerce',
      'e-commerce',
      'landing page',
      'microsite',
      'cms',
      'ux',
      'ui',
      'redesign',
      'responsive',
    ],
    roles: [
      { title: 'Frontend Developer', discipline: 'frontend-developer', weight: 35 },
      { title: 'UX Designer', discipline: 'ux-designer', weight: 25 },
      { title: 'UI Designer', discipline: 'ui-designer', weight: 20 },
      { title: 'Copywriter', discipline: 'copywriter', weight: 20 },
    ],
  },
  {
    id: 'copy',
    keywords: [
      'copy',
      'copywriting',
      'script',
      'story',
      'narrative',
      'words',
      'tagline',
      'article',
      'blog',
      'poem',
      'spoken word',
      'voiceover',
      'voice over',
    ],
    roles: [
      { title: 'Copywriter', discipline: 'copywriter', weight: 40 },
      { title: 'Content Writer', discipline: 'content-writer', weight: 30 },
      { title: 'Voice Actor', discipline: 'voice-actor', weight: 30 },
    ],
  },
];

/**
 * Used when nothing matches.
 *
 * Deliberately generic rather than the three most populated disciplines, which
 * is what it used to be. A brief this engine did not understand is not
 * evidence that the work needs a photographer — and proposing one anyway is
 * worse than proposing little, because it reads as a recommendation rather
 * than a guess. A company on a contractor workspace typing something outside
 * the talent vocabulary got a film crew and had to delete it row by row.
 *
 * Project Manager and Talent Director are the two roles that are plausible
 * on almost any brief, so they survive; the third slot is gone.
 */
const FALLBACK: ProposedRole[] = [
  { title: 'Project Manager', discipline: 'project-manager', weight: 50 },
  { title: 'Creative Director', discipline: 'creative-director', weight: 50 },
];

export interface BriefSplit {
  /** Template ids that matched, strongest first. Surfaced so the UI can say
   *  why it proposed this crew instead of presenting it as a black box. */
  matched: string[];
  roles: Array<{ title: string; discipline: string; percentage: number }>;
}

/**
 * Proposes a crew for a brief.
 *
 * Percentages are shares of the CREW POOL and always sum to exactly 100, so
 * they can be handed straight to splitPot(). The platform fee is applied
 * separately and is not represented here.
 */
export function splitBrief(brief: string, maxRoles = 5): BriefSplit {
  const text = brief.toLowerCase();

  const scored = TEMPLATES.map((template) => ({
    template,
    score: template.keywords.reduce(
      (sum, keyword) => sum + (matchesWord(text, keyword) ? 1 : 0),
      0,
    ),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));

  if (scored.length === 0) {
    return { matched: [], roles: normalise(FALLBACK.slice(0, maxRoles)) };
  }

  // Merge the matched templates, strongest first, keeping each discipline once
  // and weighting by how strongly its template matched. A brief mentioning
  // both "launch event" and "content" should get a crew drawn from both.
  const byDiscipline = new Map<string, ProposedRole>();
  for (const { template, score } of scored) {
    for (const role of template.roles) {
      const existing = byDiscipline.get(role.discipline);
      if (existing) {
        existing.weight = Math.max(existing.weight, role.weight * score);
      } else {
        byDiscipline.set(role.discipline, { ...role, weight: role.weight * score });
      }
    }
  }

  const roles = Array.from(byDiscipline.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxRoles);

  return { matched: scored.map((s) => s.template.id), roles: normalise(roles) };
}

/**
 * Scales weights to integer percentages summing to exactly 100.
 *
 * Same largest-remainder approach as money.ts: rounding each share
 * independently would leave the total at 99 or 101, and a crew split that
 * doesn't total 100% either strands budget or overspends it.
 */
function normalise(
  roles: ProposedRole[],
): Array<{ title: string; discipline: string; percentage: number }> {
  if (roles.length === 0) return [];

  const total = roles.reduce((sum, r) => sum + r.weight, 0);
  const exact = roles.map((r) => (r.weight / total) * 100);
  const out = exact.map(Math.floor);
  let remainder = 100 - out.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value), value }))
    .sort((a, b) => b.frac - a.frac || b.value - a.value || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    out[order[i].index] += 1;
    remainder -= 1;
  }

  return roles.map((r, i) => ({
    title: r.title,
    discipline: r.discipline,
    percentage: out[i],
  }));
}

/** Whole-word-ish match, so "ad" doesn't fire on "advertising agency" twice
 *  and "ep" doesn't match inside "epic". */
function matchesWord(text: string, keyword: string): boolean {
  if (keyword.includes(' ')) return text.includes(keyword);
  const pattern = new RegExp(`(^|[^a-z])${escapeRegExp(keyword)}([^a-z]|$)`, 'i');
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
