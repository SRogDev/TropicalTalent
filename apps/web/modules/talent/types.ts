/** A talent, as the team builder and the Talent page see them. */
export interface TalentCandidate {
  id: string;
  username: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  passion: string | null;
  /** Free-text skills from creative_data.tags. */
  tags: string[];
  /** Canonical discipline slugs. */
  disciplines: string[];
  /** Showreel — YouTube, Vimeo or a direct video URL. */
  showreelUrl: string | null;
  locationDisplay: string | null;
  jobsDone: number;
  isFavourite: boolean;
  /** True when this candidate holds the discipline as their primary. */
  isPrimaryMatch: boolean;
  /**
   * Share of past-project feedback that recommended this talent, 0–1.
   * Null when nobody has left feedback yet — treated as neutral, not bad.
   */
  recommendRate: number | null;
  feedbackCount: number;
}

/** A brand's recommend/don't-recommend verdict on a talent for one project. */
export interface CreativeFeedback {
  creativeId: string;
  recommend: boolean;
}

export interface TalentPage {
  candidates: TalentCandidate[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TalentFilter {
  search?: string;
  disciplines?: string[];
  favouritesOnly?: boolean;
}
