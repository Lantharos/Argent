import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const svgPath = path.join(rootDir, 'public', 'icon.svg')
const outputPaths = [
  path.join(rootDir, 'build', 'icon.png'),
  path.join(rootDir, 'electron', 'assets', 'icon.png'),
]

const iconBuffer = await sharp(svgPath, { density: 1024 })
  .resize(1024, 1024, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer()

await Promise.all(
  outputPaths.map(async outputPath => {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, iconBuffer)
  }),
)

console.log(`Generated Electron icons from ${path.relative(rootDir, svgPath)}`)
