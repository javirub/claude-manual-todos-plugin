export interface BoardParams {
  state?: string;
  owner?: string;
  q?: string;
  task?: string;
  /**
   * The project rail, on the widths where it is not always on screen. URL state
   * like everything else here, so the back button closes it and a link to a
   * board is a link to the same board on a phone.
   */
  rail?: string;
}

/** Builds a board URL keeping the filters the user already has set. */
export function boardHref(base: string, params: BoardParams, overrides: Partial<BoardParams> = {}): string {
  const merged = { ...params, ...overrides };
  const search = new URLSearchParams();
  for (const key of ["state", "owner", "q", "task", "rail"] as const) {
    const value = merged[key];
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

export function readParams(input: Record<string, string | string[] | undefined>): BoardParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  return {
    state: one(input.state),
    owner: one(input.owner),
    q: one(input.q),
    task: one(input.task),
    rail: one(input.rail),
  };
}
