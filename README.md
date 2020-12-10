# `lsbranch`

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
