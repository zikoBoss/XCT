import 'dotenv/config'
import { stdin, stderr, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { getPayload } from 'payload'
import {
  AdminBootstrapAlreadyCompleteError,
  createFirstAdmin,
} from '../src/access/bootstrapAdmin.js'
import config from '../src/payload.config.js'

const readHidden = (prompt: string): Promise<string> => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Bootstrap requires an interactive terminal.')
  }

  stdout.write(prompt)

  return new Promise((resolve, reject) => {
    const characters: string[] = []

    const finish = (error?: Error) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')

      if (error) {
        reject(error)
      } else {
        resolve(characters.join(''))
      }
    }

    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new Error('Input cancelled.'))
          return
        }

        if (character === '\r' || character === '\n') {
          finish()
          return
        }

        if (character === '\u007f' || character === '\b') {
          characters.pop()
          continue
        }

        characters.push(character)
      }
    }

    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    stdin.on('data', onData)
  })
}

const promptEmail = async (): Promise<string> => {
  const terminal = createInterface({ input: stdin, output: stdout })

  try {
    return (await terminal.question('Administrator email: ')).trim()
  } finally {
    terminal.close()
  }
}

const main = async () => {
  if (process.argv.length > 2) {
    throw new Error('Do not pass bootstrap credentials as command-line arguments.')
  }

  if (!process.env.DATABASE_URL || !process.env.PAYLOAD_SECRET) {
    throw new Error('DATABASE_URL and PAYLOAD_SECRET must be configured.')
  }

  let password = ''
  let confirmation = ''

  try {
    const email = await promptEmail()
    password = await readHidden('Administrator password (input hidden): ')
    confirmation = await readHidden('Confirm password (input hidden): ')

    if (password !== confirmation) {
      throw new Error('The entered passwords do not match.')
    }

    const payload = await getPayload({ config: await config })

    try {
      await createFirstAdmin(payload, email, password)
      stdout.write('First administrator created.\n')
    } finally {
      await payload.destroy()
    }
  } finally {
    password = ''
    confirmation = ''
  }
}

main().catch((error: unknown) => {
  if (error instanceof AdminBootstrapAlreadyCompleteError) {
    stderr.write(`${error.message}\n`)
  } else {
    stderr.write('Bootstrap failed. Verify the database and terminal, then retry.\n')
  }
  process.exit(1)
})
