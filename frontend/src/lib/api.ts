// Client de l'API du Wiki (même origine : /api). Toute erreur devient une ApiError avec le message français du serveur.

export interface Space {
  id: number
  slug: string
  name: string
  icon: string
  description: string
  position: number
  pageCount: number
  createdAt: string
  updatedAt: string
}

export interface PageSummary {
  id: number
  spaceId: number
  parentId: number | null
  title: string
  slug: string
  icon: string
  position: number
  pinned: boolean
  version: number
  updatedAt: string
  updatedBy: string
}

export interface PageRef {
  id: number
  title: string
  icon: string
  slug: string
}

export interface PageDetail extends PageSummary {
  content: string
  createdAt: string
  createdBy: string
  deletedAt: string | null
  space: { id: number; name: string; slug: string; icon: string }
  breadcrumbs: PageRef[]
  children: (PageSummary & { excerpt: string })[]
  backlinks: (PageRef & { spaceId: number })[]
}

export interface TitleEntry {
  id: number
  title: string
  icon: string
  spaceId: number
}

export interface SearchHit {
  id: number
  title: string
  slug: string
  icon: string
  spaceId: number
  spaceName: string
  updatedAt: string
  snippet: string
}

export interface RevisionSummary {
  version: number
  title: string
  author: string
  summary: string
  createdAt: string
  size: number
}

export interface Revision {
  version: number
  title: string
  icon: string
  content: string
  author: string
  summary: string
  createdAt: string
}

export interface TrashEntry {
  id: number
  title: string
  icon: string
  spaceId: number
  spaceName: string
  deletedAt: string
  deletedBy: string
  pages: number
}

export interface Attachment {
  id: number
  pageId: number | null
  name: string
  mime: string
  size: number
  url: string
  isImage: boolean
  createdBy: string
  createdAt: string
}

export interface Home {
  spaces: Space[]
  pinned: (PageSummary & { spaceName: string })[]
  recent: (PageSummary & { excerpt: string; spaceName: string })[]
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Le Wiki ne répond pas. Vérifie ta connexion, puis réessaie.')
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const payload = (data ?? {}) as { detail?: string; code?: string }
    // Le portail de la suite renvoie vers sa page de connexion quand la session a expiré.
    if (response.status === 401 || response.redirected) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Ta session a expiré : recharge la page pour te reconnecter.')
    }
    throw new ApiError(response.status, payload.code ?? 'ERROR', payload.detail ?? `Erreur ${response.status}.`, (data ?? {}) as Record<string, unknown>)
  }
  return data as T
}

export const api = {
  me: () => request<{ user: string; version: string }>('GET', '/api/me'),
  home: () => request<Home>('GET', '/api/home'),

  spaces: () => request<Space[]>('GET', '/api/spaces'),
  createSpace: (input: { name: string; icon?: string; description?: string }) => request<Space>('POST', '/api/spaces', input),
  updateSpace: (id: number, input: { name?: string; icon?: string; description?: string }) => request<Space>('PATCH', `/api/spaces/${id}`, input),
  deleteSpace: (id: number) => request<void>('DELETE', `/api/spaces/${id}`),
  tree: (spaceId: number) => request<PageSummary[]>('GET', `/api/spaces/${spaceId}/tree`),
  titles: () => request<TitleEntry[]>('GET', '/api/titles'),

  page: (id: number) => request<PageDetail>('GET', `/api/pages/${id}`),
  createPage: (input: { spaceId: number; parentId?: number | null; title: string; content?: string; icon?: string; index?: number }) =>
    request<PageDetail>('POST', '/api/pages', input),
  updatePage: (id: number, input: { title?: string; content?: string; icon?: string; baseVersion: number; summary?: string }) =>
    request<PageDetail>('PUT', `/api/pages/${id}`, input),
  movePage: (id: number, input: { spaceId?: number; parentId: number | null; index?: number }) => request<PageDetail>('POST', `/api/pages/${id}/move`, input),
  pin: (id: number, pinned: boolean) => request<PageDetail>('POST', `/api/pages/${id}/pin`, { pinned }),
  trashPage: (id: number) => request<{ trashed: number }>('DELETE', `/api/pages/${id}`),
  revisions: (id: number) => request<RevisionSummary[]>('GET', `/api/pages/${id}/revisions`),
  revision: (id: number, version: number) => request<Revision>('GET', `/api/pages/${id}/revisions/${version}`),
  restoreRevision: (id: number, version: number) => request<PageDetail>('POST', `/api/pages/${id}/revisions/${version}/restore`),
  attachments: (id: number) => request<Attachment[]>('GET', `/api/pages/${id}/attachments`),

  search: (q: string, limit = 20) => request<SearchHit[]>('GET', `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  trash: () => request<{ days: number; entries: TrashEntry[] }>('GET', '/api/trash'),
  restoreTrash: (id: number) => request<PageDetail>('POST', `/api/trash/${id}/restore`),
  purgeTrash: (id: number) => request<{ deleted: number }>('DELETE', `/api/trash/${id}`),

  upload: (file: File, pageId: number | null) => {
    const form = new FormData()
    if (pageId !== null) form.append('pageId', String(pageId))
    form.append('file', file, file.name)
    return request<Attachment>('POST', '/api/attachments', form)
  },
}

export const pagePath = (page: { id: number; slug?: string; title?: string }) => `/p/${page.id}${page.slug ? `-${page.slug}` : ''}`
