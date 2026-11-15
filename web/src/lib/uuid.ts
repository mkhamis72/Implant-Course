const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed UUID (either case): check ids from the URL before they reach a query. */
export const isUuid = (v: string): boolean => UUID.test(v);
