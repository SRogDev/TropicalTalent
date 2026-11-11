export interface Discipline {
  slug: string;
  label: string;
  category: string;
}

/** A discipline plus how many talent currently hold it. */
export interface DisciplineOption extends Discipline {
  holders: number;
}
