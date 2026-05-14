const LOCAL_ORIGIN = "https://dashframe.local";

export type ParsedHref = {
  href: string;
  isExternal: boolean;
  to: string;
  search?: Record<string, string | string[]>;
  hash?: string;
};

function searchParamsToObject(searchParams: URLSearchParams) {
  const search: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams) {
    const current = search[key];
    if (current === undefined) {
      search[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      search[key] = [current, value];
    }
  }

  return Object.keys(search).length > 0 ? search : undefined;
}

export function parseNextHref(href: string): ParsedHref {
  try {
    const url = new URL(href, LOCAL_ORIGIN);
    const isExternal = url.origin !== LOCAL_ORIGIN;

    if (isExternal) {
      return { href, isExternal, to: href };
    }

    return {
      href,
      isExternal: false,
      to: url.pathname || "/",
      search: searchParamsToObject(url.searchParams),
      hash: url.hash ? url.hash.slice(1) : undefined,
    };
  } catch {
    return { href, isExternal: false, to: href };
  }
}
