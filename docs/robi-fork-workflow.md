# Maintaining the Robi fork

## Repository roles

- `upstream`: official `https://github.com/nanocoai/nanoclaw.git`, fetch only.
- `origin`: the operator's authenticated GitHub fork; all pushes go here.
- Local `main`: unmodified NanoClaw synchronization baseline, tracking `upstream/main`.
- `robi`: installed channel/provider/gateway commits and Robi implementation.
- Remote `origin/main`: the maintained Robi version published on the fork.
- `feature/robi-health-coach`: historical branch containing the initial runner seam.

Use repository-local settings, not global Git settings:

```sh
git remote set-url --push upstream DISABLED
git config --local remote.pushDefault origin
git config --local push.default current
git config --local branch.main.pushRemote origin
git config --local branch.robi.pushRemote origin
```

`DISABLED` is an intentionally invalid upstream push destination. An ordinary
`git push upstream` fails without contacting the official repository. This is
protection against mistakes, not an access-control boundary: deliberately changing
Git configuration or pushing to an explicit URL can bypass it.

Check `git remote -v` before publishing. Set each new feature branch's push remote
to `origin`; its pull tracking can be established with `git push -u origin <branch>`
only after the branch's contents have been reviewed for publication.

## Ownership of files

- Shared platform integration: generic runner turn-policy registry and lifecycle calls.
- Robi extension: `container/agent-runner/src/modules/robi-whatsapp/` and
  `src/modules/robi-whatsapp/`, enabled through the mailbox composition and module import.
- WhatsApp overlay: installed `src/channels/whatsapp.ts` and its reaction/text helpers.
- Local workspace: `groups/<agent-folder>/`, including SOUL, profiles, skills and configuration.

The real `whatsapp-interaction.json` stays in the ignored local workspace. The
placeholder-only example is
`container/agent-runner/src/modules/robi-whatsapp/whatsapp-interaction.example.json`.
Keep `.env`, `store/`, `data/` and `logs/` local too. Never force-add these paths.
Do not include unrelated ignore changes or generated review patches in a feature commit.

## Commit the current work

Use two reviewed commits: generic turn-policy integration first, then the scoped
extension, WhatsApp overlay, focused tests, example and this workflow document.
The three installation commits belong on `robi` and the fork's published `main`;
the local upstream synchronization branch stays clean. Stage explicit files, inspect
`git diff --cached`, then commit. Do not use `git add .` for publication preparation.

## Updating NanoClaw later

Finish reviewing and committing work first. Do not rebase a dirty working tree.
Do not check out clean `main` in the running installation: installed integrations
are intentionally absent there, and runner source is mounted live into containers.

Synchronize `main` in a separate worktree instead:

```sh
# Run once; reuse this worktree for later updates.
git worktree add ../nanoclaw-upstream-sync main

# Run for each synchronization; this local baseline is not the fork main.
git -C ../nanoclaw-upstream-sync fetch upstream
git -C ../nanoclaw-upstream-sync merge --ff-only upstream/main
```

This changes no feature checkout files. Upstream pushes remain disabled.

Integrating that baseline into the live feature branch is a separate deployment:
stop NanoClaw and its session containers before rewriting mounted source, or use
the repository's transactional update skill. Keep mutable-state backups and follow
the migration instructions supplied by the target release.

```sh
# Only after the installation is stopped and the working tree is clean:
git switch robi
git rebase main

# Resolve conflicts deliberately, run required checks, then rebuild and restart.
# Use git rebase --abort to abandon a failed integration without dropping commits.
```

Review the resulting diff, test the extension and native paths, and verify
WhatsApp reconnects before publishing. A previously published rebased branch
needs a separately approved `git push --force-with-lease origin robi`;
never use plain `--force`.

## Publishing Robi

After reviewing and testing committed changes, publish to the fork only:

```sh
git push -u origin robi
git push origin robi:refs/heads/main
```

The second command requires the fork main to be an ancestor of `robi`; Git rejects
a non-fast-forward update. Never force-push the fork main. If it has diverged,
merge the fork main into `robi` and test before publishing.
