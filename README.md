# `lsbranch`

Do you ever find yourself working on multiple feature branches across a number of clones of the same repo?

This is a simple tool for listing the checked-out branches across all of your clones!

## Installation

Install `lsbranch` globally with `npm install -g lsbranch`.

Then create a config file in your HOME folder called `.lsbranchrc.json` enumerating your repos in the following format:

```JavaScript
{
  "repos": [
    {
      "path": "/path/to/repo1", // Or, "C:\\path\\to\\repo" on Windows
      "alias" "Repo 1" // The "alias" field is optional
    },
    {
      "path": "/path/to/repo2",
      "alias" "Repo 2"
    }
  ]
}
```

## Usage

Run `lsbranch ls` to see the listed repos' currently checked out branches

```
> lsbranch ls
Repo 1  main
Repo 2  feature/branch
```

Thats it!
