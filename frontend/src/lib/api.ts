import { clearSession, getToken } from "@/lib/auth";
import { MOCK_MODE, mockFetch } from "@/lib/mockApi";
import type { ApiError } from "@/types";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:5115/api";

function doFetch(path: string, init: RequestInit): Promise<Response> {
  return MOCK_MODE ? mockFetch(path, init) : fetch(`${API_BASE_URL}${path}`, init);
}

export class HttpError extends Error implements ApiError {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
    }

    const message = await response.text();
    throw new HttpError(message || response.statusText, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await doFetch(path, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders() },
  });

  return parseResponse<T>(response);
}

export async function apiPost<T, B = unknown>(
  path: string,
  body: B,
): Promise<T> {
  const response = await doFetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  return parseResponse<T>(response);
}

export async function apiPut<T, B = unknown>(
  path: string,
  body: B,
): Promise<T> {
  const response = await doFetch(path, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  return parseResponse<T>(response);
}

export async function apiPostForm<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const response = await doFetch(path, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders() },
    body: formData,
  });

  return parseResponse<T>(response);
}

export async function apiDelete(path: string): Promise<void> {
  const response = await doFetch(path, {
    method: "DELETE",
    headers: { Accept: "application/json", ...authHeaders() },
  });

  await parseResponse<void>(response);
}
