/**
 * Markdown for AI agents
 *
 * Serves a Markdown version of any HTML page when the request includes
 * `Accept: text/markdown`. Regular browser requests pass through untouched.
 * Markdown is typically ~80% fewer tokens than the equivalent HTML.
 *
 * Test against a deployed site:
 *   curl -H "Accept: text/markdown" https://your-site.netlify.app/path
 *   curl -sI -H "Accept: text/markdown" https://your-site.netlify.app/path   # headers only
 *
 * Test locally:
 *   netlify dev --port 8889
 *   curl -H "Accept: text/markdown" http://localhost:8889/path
 *
 * Adding or removing paths:
 *   The scope of this function is configured in `netlify.toml` under the
 *   `[[edge_functions]]` block for `function = "markdown"`.
 *   - To add content paths, add another `[[edge_functions]]` block with
 *     `function = "markdown"` and the new `path` (e.g. `path = "/blog/*"`).
 *   - To exclude paths, add them to the `excludedPath` array
 *     (e.g. `"/admin/*"`).
 *   Non-HTML responses are always passed through unchanged, so a broad
 *   scope is safe.
 */
// Turndown is installed from npm (see package.json) and imported by package
// name, which is how the Netlify edge bundler resolves npm modules.
import TurndownService from "turndown";
import type { Context } from "https://edge.netlify.com";

// Elements that never carry page content.
const STRIP_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "canvas",
  "form",
  "button",
  "nav",
  "header",
  "footer",
  "aside",
];

// Landmark roles / class names used for chrome rather than content.
const NON_CONTENT_ROLES = ["navigation", "banner", "contentinfo", "complementary", "search"];
const NON_CONTENT_CLASS = /(^|[\s_-])(sidebar|side-bar|nav|navbar|menu|breadcrumbs?|footer|header|cookie|banner|skip-link)([\s_-]|$)/i;

function extractContent(html: string): { title: string; body: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";

  // Prefer the main content region when the page declares one.
  const region =
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    html;

  return { title, body: region };
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  turndown.remove(STRIP_TAGS);
  turndown.remove((node: any) => {
    const role = node.getAttribute?.("role");
    if (role && NON_CONTENT_ROLES.includes(role)) return true;
    if (node.getAttribute?.("aria-hidden") === "true") return true;
    const className = node.getAttribute?.("class") ?? "";
    const id = node.getAttribute?.("id") ?? "";
    return NON_CONTENT_CLASS.test(className) || NON_CONTENT_CLASS.test(id);
  });

  return turndown;
}

export default async (req: Request, context: Context) => {
  const accept = req.headers.get("accept") ?? "";
  if (!accept.toLowerCase().includes("text/markdown")) {
    return; // Not an agent asking for Markdown: let the request proceed normally.
  }

  const response = await context.next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("text/html")) {
    return response;
  }

  const html = await response.text();

  try {
    const { title, body } = extractContent(html);
    let markdown = createTurndown().turndown(body).trim();

    if (title && !markdown.startsWith("# ")) {
      markdown = `# ${title}\n\n${markdown}`;
    }
    markdown += "\n";

    return new Response(markdown, {
      status: response.status,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Markdown-Tokens": String(Math.ceil(markdown.length / 4)),
        "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
        "Vary": "Accept",
      },
    });
  } catch (error) {
    console.error("Markdown conversion failed, serving original HTML:", error);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
};
