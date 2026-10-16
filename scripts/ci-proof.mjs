import { setTimeout } from 'node:timers/promises'

export function reusableProof(proof, tree, runId) {
  return (
    proof?.schema === 3 &&
    proof.tree === tree &&
    /^[0-9a-f]{40}$/.test(tree) &&
    /^[0-9a-f]{40}$/.test(proof.sha) &&
    proof.scope === 'full' &&
    proof.breadth === 'full' &&
    Number(runId) > 0 &&
    proof.runId === Number(runId)
  )
}

export function assertGate(needs, reused, scope, breadth) {
  if (!['pr', 'full'].includes(breadth) || (reused && breadth !== 'full')) {
    throw new Error(`Invalid proof breadth: ${breadth}`)
  }
  if (!['web', 'full'].includes(scope)) {
    throw new Error(`Unknown CI scope: ${scope}`)
  }
  const expected = {
    changes: 'success',
    ui: reused ? 'skipped' : 'success',
    server: !reused && scope === 'full' ? 'success' : 'skipped',
    runtime: !reused && scope === 'full' ? 'success' : 'skipped',
    'browser-local': !reused && scope === 'full' ? 'success' : 'skipped',
  }
  for (const [job, result] of Object.entries(expected)) {
    if (needs[job]?.result !== result) {
      throw new Error(`${job}: expected ${result}, got ${needs[job]?.result}`)
    }
  }
}

async function mergedStackTip(github, context, pull) {
  const { owner, repo } = context.repo
  const number = pull.stack?.number
  if (!Number.isSafeInteger(number) || number <= 0 || pull.stack.base?.ref !== 'main') {
    return null
  }
  const { data: stack } = await github.request('GET /repos/{owner}/{repo}/stacks/{number}', {
    owner,
    repo,
    number,
  })
  const members = stack.pull_requests
  if (
    stack.number !== number ||
    stack.open !== false ||
    stack.base?.ref !== 'main' ||
    !Array.isArray(members) ||
    members.length !== pull.stack.size ||
    !members.some((member) => member.number === pull.number && member.merged_at)
  ) {
    return null
  }
  const tipNumber = members.at(-1)?.number
  if (!Number.isSafeInteger(tipNumber) || tipNumber <= 0) {
    return null
  }
  const { data: tip } = await github.rest.pulls.get({ owner, repo, pull_number: tipNumber })
  return tip.number === tipNumber &&
    tip.merged_at &&
    tip.merge_commit_sha === context.sha &&
    tip.head.repo?.full_name === `${owner}/${repo}` &&
    tip.stack?.number === number &&
    tip.stack.base?.ref === 'main' &&
    tip.stack.position === members.length &&
    tip.stack.size === members.length
    ? tip
    : null
}

export async function findPrRun(github, context) {
  const { owner, repo } = context.repo
  const { data: pulls } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: context.sha,
  })
  for (const pull of pulls) {
    if (
      !pull.merged_at ||
      pull.merge_commit_sha !== context.sha ||
      pull.base.ref !== 'main' ||
      pull.head.repo?.full_name !== `${owner}/${repo}`
    ) {
      continue
    }
    const candidate = (await mergedStackTip(github, context, pull)) ?? pull
    const { data } = await github.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: 'web-ci.yml',
      event: 'pull_request',
      status: 'success',
      head_sha: candidate.head.sha,
      per_page: 10,
    })
    const run = data.workflow_runs.find(
      (run) =>
        run.conclusion === 'success' &&
        run.head_sha === candidate.head.sha &&
        run.event === 'pull_request',
    )
    if (run) {
      return run.id
    }
  }
  return null
}

export async function waitForMainCi(github, context, core, sleep = setTimeout) {
  if (context.ref !== 'refs/heads/main') {
    throw new Error('Production publication requires main')
  }
  const { owner, repo } = context.repo
  for (let attempt = 0; attempt < 180; attempt++) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: 'web-ci.yml',
      head_sha: context.sha,
      per_page: 20,
    })
    const run = data.workflow_runs
      .filter(
        (run) =>
          run.head_sha === context.sha &&
          run.head_branch === 'main' &&
          ['push', 'workflow_dispatch'].includes(run.event),
      )
      .sort((a, b) => b.id - a.id)[0]
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Main CI ${run.id} ended with ${run.conclusion}`)
      }
      const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        owner,
        repo,
        run_id: run.id,
      })
      if (!jobs.some((job) => job.name === 'CI gate' && job.conclusion === 'success')) {
        throw new Error(`Main CI ${run.id} has no successful CI gate`)
      }
      core.info(`Main CI ${run.id} passed for ${context.sha}`)
      return run.id
    }
    if (attempt === 0) {
      core.info(`Waiting up to 45 minutes for main CI at ${context.sha}`)
    }
    await sleep(15_000)
  }
  throw new Error(`No successful main CI for ${context.sha} within 45 minutes`)
}
