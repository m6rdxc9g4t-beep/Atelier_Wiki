// Transport HTTP vers Ollama, de même signature que `fetch`, sans délai imposé.
// Le `fetch` global de Node (undici) abandonne si les en-têtes de réponse n'arrivent pas en 300 s
// (headersTimeout), quel que soit le signal. Or Ollama, sans flux, n'envoie rien avant la fin de la génération,
// qui peut dépasser 5 minutes sans GPU. Ici, seul le signal (OLLAMA_TIMEOUT_MS, annulation) arrête la requête.

import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

import type { FetchFn } from './ai.js'

/** Statuts qui n'ont jamais de corps (Response les refuse avec un corps). */
const NULL_BODY = new Set([101, 103, 204, 205, 304])

function bodyBuffer(body: RequestInit['body']): Buffer | null {
  if (body === undefined || body === null) return null
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Uint8Array) return Buffer.from(body)
  throw new TypeError('Corps de requête non pris en charge par le transport HTTP (texte ou octets attendus).')
}

function responseHeaders(message: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
  }
  return headers
}

/** Requête HTTP(S) par `node:http` : aucun délai propre, arrêt par `init.signal` seulement (raison du signal conservée). */
export const nodeHttpFetch: FetchFn = (input, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    const signal = init.signal ?? undefined
    if (signal?.aborted) return reject(signal.reason)

    let url: URL
    let payload: Buffer | null
    try {
      url = new URL(input)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`Protocole non pris en charge : ${url.protocol}`)
      payload = bodyBuffer(init.body)
    } catch (error) {
      return reject(error)
    }

    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value
    })
    if (payload) headers['content-length'] = String(payload.length)

    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(url, { method: init.method ?? 'GET', headers })

    const onAbort = () => {
      req.destroy()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => signal?.removeEventListener('abort', onAbort)

    req.on('error', (error) => {
      done()
      reject(signal?.aborted ? signal.reason : new TypeError('fetch failed', { cause: error }))
    })
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', (error) => {
        done()
        reject(signal?.aborted ? signal.reason : new TypeError('fetch failed', { cause: error }))
      })
      res.on('end', () => {
        done()
        const status = res.statusCode ?? 502
        const body = NULL_BODY.has(status) ? null : Buffer.concat(chunks)
        resolve(new Response(body, { status, statusText: res.statusMessage ?? '', headers: responseHeaders(res) }))
      })
    })
    req.end(payload ?? undefined)
  })
