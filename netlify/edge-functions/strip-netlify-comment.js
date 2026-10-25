export default async (_req, context) => {
  const response = await context.next();
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;
  const html = await response.text();
  if (!html.includes("hosted on Netlify")) return new Response(html, response);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html.replace(/<!-- This site is hosted on Netlify[\s\S]*?-->/g, ""), { status: response.status, headers });
};

export const config = { path: "/*" };
