import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const HOST = '127.0.0.1'

const MIME_TYPES = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function toRootToken(workspacePath) {
  return Buffer.from(path.resolve(workspacePath), 'utf8').toString('base64url')
}

function fromRootToken(token) {
  return Buffer.from(token, 'base64url').toString('utf8')
}

function resolveMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function isPathInsideRoot(rootPath, candidatePath) {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedCandidate = path.resolve(candidatePath)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

function parsePreviewRequest(requestUrl) {
  const url = new URL(requestUrl, `http://${HOST}`)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'preview' || segments.length < 3) {
    return null
  }

  const [, rootToken, ...relativeSegments] = segments
  const workspacePath = fromRootToken(rootToken)
  const relativePath = relativeSegments.map((segment) => decodeURIComponent(segment)).join('/')

  return {
    workspacePath,
    relativePath,
  }
}

export class LocalPreviewServer {
  constructor() {
    this.server = null
    this.port = null
    this.pendingStart = null
  }

  async ensureRunning() {
    if (this.port) {
      return this.port
    }

    if (this.pendingStart) {
      return this.pendingStart
    }

    this.pendingStart = new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        if (!request.url) {
          response.writeHead(400)
          response.end('Missing URL')
          return
        }

        const requestTarget = parsePreviewRequest(request.url)
        if (!requestTarget) {
          response.writeHead(404)
          response.end('Not found')
          return
        }

        const filePath = path.resolve(requestTarget.workspacePath, requestTarget.relativePath)
        if (!isPathInsideRoot(requestTarget.workspacePath, filePath)) {
          response.writeHead(403)
          response.end('Forbidden')
          return
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          response.writeHead(404)
          response.end('Not found')
          return
        }

        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': resolveMimeType(filePath),
        })

        const stream = fs.createReadStream(filePath)
        stream.on('error', () => {
          if (!response.headersSent) {
            response.writeHead(500)
          }
          response.end('Failed to read file')
        })
        stream.pipe(response)
      })

      server.on('error', (error) => {
        this.pendingStart = null
        reject(error)
      })

      server.listen(0, HOST, () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close()
          this.pendingStart = null
          reject(new Error('Could not start preview server'))
          return
        }

        this.server = server
        this.port = address.port
        this.pendingStart = null
        resolve(address.port)
      })
    })

    return this.pendingStart
  }

  async getPreviewUrl(workspacePath, filePath) {
    const port = await this.ensureRunning()
    const resolvedWorkspacePath = path.resolve(workspacePath)
    const resolvedFilePath = path.resolve(filePath)

    if (!isPathInsideRoot(resolvedWorkspacePath, resolvedFilePath)) {
      throw new Error('Preview file must be inside the workspace root.')
    }

    const relativePath = path.relative(resolvedWorkspacePath, resolvedFilePath)
    const pathname = relativePath
      .split(path.sep)
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    return `http://${HOST}:${port}/preview/${toRootToken(resolvedWorkspacePath)}/${pathname}`
  }

  async close() {
    if (!this.server) {
      return
    }

    const server = this.server
    this.server = null
    this.port = null
    this.pendingStart = null

    await new Promise((resolve) => {
      server.close(() => resolve(true))
    })
  }
}
