export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const causalMessage = (() => {
      const cause = (error as Error & { cause?: unknown }).cause;

      if (cause instanceof Error) {
        return cause.message;
      }

      if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
        return cause.message;
      }

      return "";
    })();

    if (error.message === "fetch failed" && causalMessage) {
      return `fetch failed: ${causalMessage}`;
    }

    return error.message;
  }

  return "Unexpected server error.";
};

const defaultJsonHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Content-Type": "application/json; charset=utf-8",
  Expires: "0",
  Pragma: "no-cache",
};

export const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...defaultJsonHeaders,
      ...(init.headers ?? {}),
    },
  });

export const errorResponse = (error: unknown, status = 400): Response =>
  jsonResponse(
    {
      error: extractErrorMessage(error),
    },
    {
      status,
    },
  );
