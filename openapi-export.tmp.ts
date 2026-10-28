import { writeFileSync } from 'node:fs'
import { openApiDocument } from './src/openapi/document.js'

writeFileSync('openapi.generated.json', JSON.stringify(openApiDocument))
console.log('openapi.generated.json written')
