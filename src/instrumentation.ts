import type { Instrumentation } from "next";
import { logError } from "@/lib/log";

/**
 * Server-side error reporting (the gap docs/BUG_AUDIT_2026-08-18.md called
 * out: both error boundaries only `console.error`'d, so "every production
 * error boundary is a screenshot and a guess").
 *
 * This is NOT a third-party error-tracking integration — no vendor has been
 * chosen and adding a dependency the founder hasn't picked would be worse
 * than the gap it closes. What it does instead is the honest, zero-dependency
 * version: Next.js hands every server-side error to `onRequestError` with the
 * request and render context attached (see node_modules/next/dist/docs/
 * 01-app/03-api-reference/03-file-conventions/instrumentation.md), and this
 * writes one structured JSON line per error through the same `logError` sink
 * the rest of the app uses. Vercel's runtime logs capture stdout/stderr, so
 * the result is searchable by `digest`, by `route`, or by message.
 *
 * `digest` is the load-bearing field: it is the same short hash React puts on
 * the error object the error boundary receives, which the boundaries now show
 * the user as their "Reference" (src/components/ui/error-reference.tsx). So a
 * user reporting "it says reference 1234567890" can be matched to the exact
 * server-side stack trace, instead of that report being a screenshot and a
 * guess. Swapping this for a real APM later means adding a sink here and in
 * src/lib/log.ts, not revisiting call sites.
 *
 * Only non-identifying request fields are logged. Headers are deliberately
 * not included wholesale — they carry the session cookie.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  logError("server.requestError", error, {
    digest: typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
  });
};
