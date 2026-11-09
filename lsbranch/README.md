# `lsbranch`

[![npm version](https://badge.fury.io/js/lsbranch.svg)](https://badge.fury.io/js/lsbranch)

Do you ever find yourself working on multiple feature branches across a number of clones of the same repo?

This is a simple tool for listing the checked-out branches across all of your clones!

## Installation

Install `lsbranch` globally with `npm install -g lsbranch`.

Then, run `lsbranch add --path /path/to/your-repo [--alias repoAlias]` to configure repos. For example:

```BASH
> lsbranch add --path /code/my-repo1/ --alias Repo1
> lsbranch add --path /code/my-repo2/ --alias Repo2
> lsbranch add --path /code/my-other-repo/
> lsbranch add --path C:\code\my-repo # On Windows
```

## Usage

Run `lsbranch` (or `lsbranch ls`) to see the configured repos' currently checked out branches. Listing flags can also be used without `ls`, for example `lsbranch --json`. Global options such as `--config PATH` precede the action or listing flags; `lsbranch --help` still shows the global help.

```BASH
> lsbranch ls
Repo 1                main
Repo 2                feature/branch
/code/my-other-repo/  master
```

Thats it!

Use `lsbranch --all` to list all local branches, with checked-out branches highlighted in green. This flag also supports `--json`.

Repository lookups read Git metadata directly from the filesystem, including loose and packed branch refs and linked-worktree Git directories. No Git subprocesses are launched. Unsupported reftable storage, symbolic links in local branch refs, and unreadable/malformed metadata are reported individually without hiding other clones' results.

Repository lookups run with a maximum concurrency of 15. The existing once-a-day npm update check is retained and can occasionally add network latency to text-mode commands.

Configuration is managed by `lsbranch add`, which resolves repository paths before saving them. Stored repository paths must be non-empty and absolute for the current operating system.

### Finding a branch

Run `lsbranch find --branch feature/name` to find every registered clone containing that local branch, including clones where it is not checked out. Shell-style globs are also supported: `lsbranch find --branch 'feature/**'`, `--branch 'release-?'`, or `--branch '{main,develop}'`. Patterns match whole branch names; `*` does not cross `/`, while `**` does. Quote patterns to prevent shell expansion. Grep-style regular expressions are not used.

Literal branch-name matches are always included, even when the name contains glob syntax such as braces. Glob-expanded matches are included alongside them without duplicates.

Text output lists every matching branch per clone and highlights matching checked-out branches in green. Use `--json` for matching clones, their `matchingBranches` and `branchIsCheckedOut` status, and individual repository errors; branches found only in remote-tracking refs do not match. A search with no matches succeeds with an empty JSON array or a text message.

### Removing a clone

Run `lsbranch remove --alias Repo1` or `lsbranch remove --path /path/to/clone` to unregister exactly one clone. Relative path arguments are resolved before matching. Supply exactly one selector; missing or ambiguous matches are errors. This only updates configuration and never deletes the clone's files.

### Repository groups

Listing and finding group clones that share a canonical Git common directory or at least one normalized remote URL. Common HTTPS, SSH, SCP-style, and Git URLs are compared by host and repository path, ignoring credentials, default transport ports, and an optional `.git` suffix. Local remotes are resolved relative to their clone. This is a heuristic, not a universal repository identifier.

Aliases sort alphabetically within each group, with paths used when there is no alias. Groups sort by their first alias/path. Text output has blank lines between groups; JSON stays a flat array in the same grouped order, with warnings sent to stderr.

A clone connecting otherwise separate repository groups produces an ambiguity warning. Git config includes, `gitdir`/`gitdir/i`, and `onbranch` conditions are supported. Unsupported include conditions, malformed configuration, and unreadable identity metadata produce a warning and leave that clone ungrouped rather than guessing its identity.

Repository-local `insteadOf` URL rewrites and enabled `worktreeConfig` are currently unsupported for grouping. Repositories using these features are left ungrouped with a warning; their branch listings remain available.

## Development

From the repository root, run `rush install`, then `rush build`. Run `rush test` to build and run tests.

Terminal-output snapshots capture severity markers, ANSI styling, spacing, and output order. Fixture paths are normalized so snapshots are independent of the checkout location and operating system.

Filesystem test fixtures use predictable, suite-specific folders under `temp/tests/` in the project directory, located from the test file via `PackageJsonLookup` rather than the working directory. Each suite resets its fixture folder before each test and removes it afterward.

When upgrading `@rushstack/heft-node-rig`, keep the explicit `typescript` dev dependency aligned with the rig's TypeScript dependency range. Heft shares its compiler program with ESLint, so the compiler and ESLint's parser must resolve the same TypeScript version.
