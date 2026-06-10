#!/usr/bin/env -S node

import { execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

type UserInfo = [string, string]

const users: Record<string, UserInfo> = {
  mcollina: ['Matteo Collina', 'hello@matteocollina.com'],
  ShogunPanda: ['Paolo Insogna', 'paolo@cowtech.it']
}

const username = process.argv[3] ?? process.env.GITHUB_ACTOR
const userInfo = users[username ?? ''] ?? users.mcollina
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const input = process.argv[2]?.replace(/^v/, '')

if (!input) {
  throw new Error('Missing version')
}

let version = input

if (['major', 'minor', 'patch'].includes(input)) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)/.exec(packageJson.version)

  if (!parsed) {
    throw new Error(`Cannot bump invalid version ${packageJson.version}`)
  }

  let major = Number.parseInt(parsed[1], 10)
  let minor = Number.parseInt(parsed[2], 10)
  let patch = Number.parseInt(parsed[3], 10)

  if (input === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (input === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }

  version = `${major}.${minor}.${patch}`
}

packageJson.version = version
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`)

if (process.env.GITHUB_ACTIONS === 'true') {
  execSync(`git config --global user.name "${userInfo[0]}"`)
  execSync(`git config --global user.email "${userInfo[1]}"`)
}

execSync(`git commit -a -m "chore: Bumped v${version}." -m "Signed-off-by: ${userInfo[0]} <${userInfo[1]}>"`)
