export const getAppBasePath = (): string => {
  const baseUrl = import.meta.env.BASE_URL || "/";
  if (baseUrl === "/" || baseUrl === "") {
    return "";
  }
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
};

export const withBasePath = (path: string): string => {
  const basePath = getAppBasePath();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
};

export const getAppOriginWithBasePath = (): string => {
  return `${window.location.origin}${getAppBasePath()}`;
};

export const resolveAppUrl = (url: string | undefined, fallbackPath: string): string => {
  if (!url || url.trim() === "") {
    return withBasePath(fallbackPath);
  }
  const trimmed = url.trim();
  // DooTask plugin: allow server-provided URLs to use "{origin}" placeholder so that they always
  // resolve to the current host origin without being affected by the app base path.
  if (trimmed.startsWith("{origin}")) {
    return `${window.location.origin}${trimmed.slice("{origin}".length)}`;
  }
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }
  const basePath = getAppBasePath();
  if (basePath && (trimmed === basePath || trimmed.startsWith(basePath + "/"))) {
    return trimmed;
  }
  return withBasePath(trimmed);
};

export const stripBasePath = (pathname: string): string => {
  const basePath = getAppBasePath();
  if (!basePath) {
    return pathname;
  }
  if (pathname === basePath) {
    return "/";
  }
  if (pathname.startsWith(basePath + "/")) {
    const stripped = pathname.slice(basePath.length);
    return stripped === "" ? "/" : stripped;
  }
  return pathname;
};
