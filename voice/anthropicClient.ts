import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { Agent, fetch as undiciFetch } from "undici";

// Every Claude request from the voice server goes over HTTP/1.1 keep-alive connections. Node 26's
// built-in fetch speaks HTTP/2 to the API and puts every request on one session; once that session
// was destroyed, each request after it failed with "Connection error" until the process restarted,
// and one voice exam run lost 348 turns to "Sorry, could you say that again?". Node 22 on Fly already
// used HTTP/1.1, so this keeps one transport on every machine.
const http1 = new Agent({ allowH2: false });

const fetchOverHttp1 = ((url: string | URL, init?: RequestInit) =>
  undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: http1 })) as unknown as typeof fetch;

export const newAnthropic = (options: ClientOptions = {}) => new Anthropic({ ...options, fetch: fetchOverHttp1 });
