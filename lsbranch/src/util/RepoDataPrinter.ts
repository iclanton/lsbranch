// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Colorize, ITerminal, TerminalTable } from '@rushstack/terminal';
import { IGetRepoDataResult } from './RepoData';

export type BranchDisplayMode = 'current' | 'all';

export function printRepoGroupsAsTable(
  terminal: ITerminal,
  groups: IGetRepoDataResult[][],
  mode: BranchDisplayMode,
  showMatchingBranches: boolean = false
): void {
  let printedGroup: boolean = false;
  for (const group of groups) {
    if (group.length === 0) {
      continue;
    }

    if (printedGroup) {
      terminal.writeLine();
    }

    printRepoDataAsTable(terminal, group, mode, showMatchingBranches);
    printedGroup = true;
  }
}

export function printRepoDataAsTable(
  terminal: ITerminal,
  results: IGetRepoDataResult[],
  mode: BranchDisplayMode,
  showMatchingBranches: boolean = false
): void {
  const table: TerminalTable = new TerminalTable({ borderless: true });
  for (const result of results) {
    const { repo } = result;
    const { alias, path } = repo;
    const name: string = alias || path;
    if ('error' in result) {
      const { error } = result;
      table.push([name, Colorize.red(error.message)]);
    } else {
      const { data } = result;
      const { checkedOutBranch, otherBranches, branchIsCheckedOut, matchingBranches } = data;
      if (showMatchingBranches) {
        if (matchingBranches === undefined) {
          throw new Error('Expected matching branch data for find output.');
        }

        for (let index: number = 0; index < matchingBranches.length; index++) {
          const branch: string = matchingBranches[index];
          table.push([
            index === 0 ? name : '',
            branchIsCheckedOut && branch === checkedOutBranch ? Colorize.green(branch) : branch
          ]);
        }
      } else {
        table.push([name, mode === 'all' ? Colorize.green(checkedOutBranch) : checkedOutBranch]);

        if (mode !== 'current' && otherBranches) {
          for (let index: number = 0; index < otherBranches.length; index++) {
            table.push(['', otherBranches[index]]);
          }
        }
      }
    }
  }

  for (const line of table.getLines()) {
    // Remove cell padding at the table edges to preserve the existing flush-left layout.
    terminal.writeLine(line.slice(1).trimEnd());
  }
}
