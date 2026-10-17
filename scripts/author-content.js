/* ==========================================================================
   Strip what Cloudflare adds to an HTML response, leaving the author's markup.

   Why this exists: hashing or comparing a raw body does not work against this
   zone. Cloudflare appends a challenge script carrying a fresh token to every
   response, so two fetches of an unchanged page differ on exactly that line and
   nowhere else. Measured on golake.app: three back-to-back fetches of the home
   page gave three different hashes, with one differing line, and it was always
   Cloudflare's.

   So every comparison runs the page through this first.
   ========================================================================== */

export function authorContent(html) {
  let h = html;
  // the challenge-platform script, however it is wrapped
  h = h.replace(/<script>\(function\(\)\{function c\(\).*?<\/script>/gs, "");
  h = h.replace(/<script[^>]*src="\/cdn-cgi\/challenge-platform[^"]*"[^>]*><\/script>/g, "");
  // the web analytics beacon
  h = h.replace(/<script[^>]*static\.cloudflareinsights\.com[^>]*><\/script>/g, "");
  // any leftover injected attributes
  h = h.replace(/\sdata-cf-beacon='[^']*'/g, "");
  // the token itself, when it is inlined rather than in a stripped script tag
  h = h.replace(/window\.__CF\$cv\$params=\{[^}]*\}/g, "window.__CF$cv_params={X}");
  // collapse whitespace so formatting differences do not register as drift
  h = h.replace(/\s+/g, " ").trim();
  return h;
}
