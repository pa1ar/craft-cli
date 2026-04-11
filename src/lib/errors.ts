// CraftError normalizes the 5+ error shapes observed in trials:
//
// 1. {error, code}                          (401, 404 GET, 400 validation, 400 regex)
// 2. {errors: [{code, message}]}             (404 PUT — plural!)
// 3. {error, code, details: [...]}          (validation body)
// 4. {error, code, details: {...}}          (regex body)
// 5. HTML string                            (unknown route)
//
// see trials/CAVEATS.md

export type CraftErrorKind =
  | "AUTH"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMIT"
  | "SERVER"
  | "UNKNOWN";

// root endpoints that always exist if the API link URL is valid. a 404 on
// any of these (exact match, ignoring query string) is much more likely to
// mean the link URL is dead/expired than "resource not found". we match
// exactly (no sub-path traversal) so a legitimate 404 on e.g.
// `/documents/<missing-uuid>` still surfaces as NOT_FOUND.
const ROOT_PATHS = new Set([
  "/connection",
  "/blocks",
  "/blocks/move",
  "/blocks/search",
  "/collections",
  "/comments",
  "/documents",
  "/documents/move",
  "/documents/search",
  "/folders",
  "/folders/move",
  "/tasks",
  "/upload",
  "/whiteboards",
]);

function isRootPath(path: string): boolean {
  // path is "VERB /endpoint?query"; strip verb and query for matching
  const withoutVerb = path.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, "");
  const [pathOnly] = withoutVerb.split("?", 1);
  return ROOT_PATHS.has(pathOnly ?? "");
}

export class CraftError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: CraftErrorKind;
  readonly details: unknown;
  readonly rawBody: string;
  readonly path: string;

  constructor(init: {
    status: number;
    path: string;
    body: unknown;
    rawBody: string;
  }) {
    const { status, body, rawBody, path } = init;

    let message = "";
    let code = "";
    let details: unknown = undefined;

    if (body && typeof body === "object") {
      const b = body as Record<string, any>;
      if (typeof b.error === "string") {
        message = b.error;
        code = b.code ?? "";
        details = b.details;
      } else if (Array.isArray(b.errors) && b.errors[0]) {
        // plural form
        message = b.errors[0].message ?? String(b.errors[0]);
        code = b.errors[0].code ?? "";
        details = b.errors;
      }
    } else if (typeof body === "string") {
      // html or plain text
      message = body.slice(0, 200);
    }

    if (!message) message = `HTTP ${status}`;

    let kind: CraftErrorKind;
    const likelyBadCreds = status === 404 && isRootPath(path) && code !== "NOT_FOUND_ERROR";
    if (status === 401 || status === 403 || code === "INVALID_AUTH_HEADER" || likelyBadCreds) {
      kind = "AUTH";
      if (likelyBadCreds) {
        message = "API link URL is invalid or expired. Regenerate it in Craft and run: craft setup --url <URL> --key <KEY>";
      }
    } else if (status === 404 || code === "NOT_FOUND_ERROR") {
      kind = "NOT_FOUND";
    } else if (status === 400 || code === "VALIDATION_ERROR" || code === "INVALID_REGEX_ERROR") {
      kind = "VALIDATION";
    } else if (status === 429) {
      kind = "RATE_LIMIT";
    } else if (status >= 500) {
      kind = "SERVER";
    } else {
      kind = "UNKNOWN";
    }

    super(`[${kind}] ${path}: ${message}`);
    this.name = "CraftError";
    this.status = status;
    this.code = code;
    this.kind = kind;
    this.details = details;
    this.rawBody = rawBody;
    this.path = path;
  }

  toExitCode(): number {
    switch (this.kind) {
      case "AUTH":
        return 3;
      case "NOT_FOUND":
        return 4;
      case "VALIDATION":
        return 1;
      default:
        return 2;
    }
  }
}
