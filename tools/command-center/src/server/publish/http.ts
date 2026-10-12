// The one way the reporter talks to the network: a small HTTP client type, and the real one made from `fetch`.
// Every caller takes the client as a parameter, so a test passes a fake and never reaches a real server.

/** One request. `timeoutMs` is how long to wait for the answer before the call fails. */
export type HttpRequest = {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
};

/** What a caller needs from an answer: the status, the `Location` header (for a redirect), and the body as text. */
export type HttpResponse = {
  status: number;
  /** The `Location` header, or null when there is none. */
  location: string | null;
  text(): Promise<string>;
};

/** Sends a request. It rejects on a network error or a timeout. It never follows a redirect: the caller reads the 3xx answer itself. */
export type HttpClient = (url: string, request: HttpRequest) => Promise<HttpResponse>;

/** The real client. `redirect: 'manual'` matters for the protection check: a redirect to the login page is the proof that the page is protected. */
export const fetchClient: HttpClient = async (url, request) => {
  const reply = await fetch(url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    redirect: 'manual',
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  return { status: reply.status, location: reply.headers.get('location'), text: () => reply.text() };
};
