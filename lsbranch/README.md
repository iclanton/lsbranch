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

Run `lsbranch ls` to see the configured repos' currently checked out branches

```BASH
> lsbranch ls
Repo 1                main
Repo 2                feature/branch
/code/my-other-repo/  master
```

Thats it!

With `--all`, Git command failures are reported for the affected repository without preventing other repositories from being listed.

Repository lookups run with a maximum concurrency of 15, including Git processes with `--all`. Results remain in configuration order.

Configuration is managed by `lsbranch add`, which resolves repository paths before saving them. Stored repository paths must be non-empty and absolute for the current operating system.

## Development

From the repository root, run `rush install`, then `rush build`. Run `rush test` to build and run tests.

Terminal-output snapshots capture severity markers, ANSI styling, spacing, and output order. Fixture paths are normalized so snapshots are independent of the checkout location and operating system.

When upgrading `@rushstack/heft-node-rig`, keep the explicit `typescript` dev dependency aligned with the rig's TypeScript dependency range. Heft shares its compiler program with ESLint, so the compiler and ESLint's parser must resolve the same TypeScript version.
