// Posts the result of the Claude review on the pull request.
//
// Why this script exists: the built-in /code-review command has a --comment flag that is meant to
// post its findings, but it can silently print them instead, and in this repo it posted nothing
// (anthropics/claude-code issue 88190). So the workflow runs /code-review without --comment, and
// this script reads the findings from the run's execution file and posts them itself.
//
// Environment: EXECUTION_FILE, PR_NUMBER, REPO (owner/name), HEAD_SHA, GH_TOKEN.
// With DRY_RUN=1 the script prints what it would post and posts nothing.
//
// It never fails the job: a review that cannot be posted is reported in the log, and the step
// "Show the Claude review result" still prints the closing text of the run.
import { existsSync, readFileSync } from 'node:fs'

const { EXECUTION_FILE, PR_NUMBER, REPO, HEAD_SHA, GH_TOKEN, DRY_RUN } = process.env
// GitHub rejects a comment body of 65,536 characters or more.
const MAX_BODY = 60000

/** The execution file is a list of the messages of the run (the Agent SDK's messages). */
function readMessages(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  return Array.isArray(parsed) ? parsed : [parsed]
}

/** The findings that the review reported through its ReportFindings tool call, or null. */
function findingsFromToolCalls(messages) {
  let level = null
  const findings = []
  let called = false
  for (const message of messages) {
    if (message?.type !== 'assistant') continue
    for (const block of message.message?.content ?? []) {
      if (block?.type !== 'tool_use' || !/ReportFindings$/.test(block.name ?? '')) continue
      called = true
      level = block.input?.level ?? level
      if (Array.isArray(block.input?.findings)) findings.push(...block.input.findings)
    }
  }
  return called ? { findings, level } : null
}

/** A JSON list of findings in the closing text of the run (a fenced block or the whole text), or null. */
function findingsFromText(text) {
  const candidates = []
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fenced) candidates.push(fenced[1])
  candidates.push(text)
  const first = text.indexOf('[')
  const last = text.lastIndexOf(']')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (Array.isArray(value)) return value
    } catch {
      // Not JSON: try the next candidate.
    }
  }
  return null
}

/** Keeps the fields that the comment needs and drops anything that is not a finding. */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const summary = String(raw.summary ?? raw.short_summary ?? '').trim()
  if (!summary) return null
  const line = Number(raw.line)
  return {
    file: typeof raw.file === 'string' && raw.file ? raw.file : null,
    line: Number.isInteger(line) && line > 0 ? line : null,
    summary,
    detail: String(raw.failure_scenario ?? raw.detail ?? '').trim(),
    category: typeof raw.category === 'string' ? raw.category : '',
  }
}

/** Stops a finding from pinging a user or a bot by a name in its text, and caps the length. */
function safe(text, max = MAX_BODY) {
  const noMentions = text.replace(/(^|[^\w`])@(?=[\w-])/g, '$1@​')
  return noMentions.length > max ? `${noMentions.slice(0, max)}\n\n(cut: the text was too long)` : noMentions
}

function where(finding) {
  if (!finding.file) return ''
  return finding.line ? `\`${finding.file}:${finding.line}\`` : `\`${finding.file}\``
}

function listItem(finding, index) {
  const place = where(finding)
  const head = `**${index + 1}.** ${place ? `${place}: ` : ''}${finding.summary}`
  return finding.detail ? `${head}\n> ${finding.detail.replace(/\n+/g, '\n> ')}` : head
}

function inlineBody(finding) {
  const tag = finding.category ? `\n\n<sub>${finding.category}</sub>` : ''
  return safe(finding.detail ? `**${finding.summary}**\n\n${finding.detail}${tag}` : `**${finding.summary}**${tag}`, 8000)
}

async function post(path, payload) {
  if (DRY_RUN) {
    console.log(`DRY RUN: POST ${path}\n${JSON.stringify(payload, null, 2)}`)
    return { ok: true, status: 200 }
  }
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'claude-review-post-script',
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  if (!response.ok) console.log(`POST ${path} answered ${response.status}: ${text.slice(0, 300)}`)
  return { ok: response.ok, status: response.status }
}

async function main() {
  if (!EXECUTION_FILE || !existsSync(EXECUTION_FILE)) {
    console.log('No Claude execution file, so there is nothing to post.')
    return
  }
  if (!DRY_RUN && !(PR_NUMBER && REPO && GH_TOKEN)) {
    console.log('PR_NUMBER, REPO or GH_TOKEN is not set, so nothing is posted.')
    return
  }

  const messages = readMessages(EXECUTION_FILE)
  const result = messages.filter((message) => message?.type === 'result').at(-1)
  if (!result) {
    console.log('The run has no result message, so there is nothing to post.')
    return
  }
  if (result.is_error) {
    console.log('The review failed. The step "Show the Claude review result" has the cause. Nothing is posted.')
    return
  }

  const closingText = String(result.result ?? '').trim()
  const fromCalls = findingsFromToolCalls(messages)
  const fromText = fromCalls ? null : findingsFromText(closingText)
  const rawFindings = fromCalls?.findings ?? fromText
  const level = fromCalls?.level ? ` (effort: ${fromCalls.level})` : ''
  const footer =
    '<sub>Posted by the workflow from the result of the built-in `/code-review` command, run on Sonnet. A review of a large pull request can skip files: read the closing text of the run.</sub>'

  let findings = null
  if (rawFindings) findings = rawFindings.map(normalize).filter(Boolean)

  // No structured findings: post the closing text of the run as the review.
  if (!findings) {
    if (!closingText) {
      console.log('The review has no findings and no closing text, so nothing is posted.')
      return
    }
    const body = safe(`## Code review\n\n${closingText}\n\n${footer}`)
    await post(`/issues/${PR_NUMBER}/comments`, { body })
    return
  }

  const closing =
    fromCalls && closingText
      ? `\n\n<details><summary>What the review says about its own work</summary>\n\n${closingText}\n\n</details>`
      : ''

  if (findings.length === 0) {
    await post(`/issues/${PR_NUMBER}/comments`, {
      body: safe(`## Code review${level}\n\nNo findings.${closing}\n\n${footer}`),
    })
    return
  }

  const inline = findings.filter((finding) => finding.file && finding.line)
  const others = findings.filter((finding) => !(finding.file && finding.line))
  const count = `${findings.length} finding${findings.length === 1 ? '' : 's'}`

  // First choice: one review with an inline comment on each line. GitHub refuses the whole review
  // when one line is not in the diff, so the second choice is a single comment with the full list.
  if (inline.length > 0 && HEAD_SHA) {
    const reviewBody = safe(
      `## Code review${level}\n\n${count}.${others.length ? `\n\nWithout a line:\n\n${others.map(listItem).join('\n\n')}` : ''}${closing}\n\n${footer}`,
    )
    const reviewed = await post(`/pulls/${PR_NUMBER}/reviews`, {
      commit_id: HEAD_SHA,
      event: 'COMMENT',
      body: reviewBody,
      comments: inline.map((finding) => ({
        path: finding.file,
        line: finding.line,
        side: 'RIGHT',
        body: inlineBody(finding),
      })),
    })
    if (reviewed.ok) return
    console.log('The inline review was refused, so the findings are posted as one comment.')
  }

  await post(`/issues/${PR_NUMBER}/comments`, {
    body: safe(`## Code review${level}\n\n${count}.\n\n${findings.map(listItem).join('\n\n')}${closing}\n\n${footer}`),
  })
}

main().catch((error) => {
  // A broken post must not fail the job: print the cause and exit normally.
  console.log(`The review could not be posted: ${error?.message ?? error}`)
})
