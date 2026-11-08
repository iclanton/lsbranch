// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Colorize, ITerminal, TerminalTable } from '@rushstack/terminal';
import { IGetRepoDataResult } from './RepoData';

export type BranchDisplayMode = 'current' | 'all' | 'other';

export function printRepoGroupsAsTable(
  terminal: ITerminal,
  groups: IGetRepoDataResult[][],
  mode: BranchDisplayMode,
  matchedBranch?: string
): void {
  let printedGroup: boolean = false;
  for (const group of groups) {
    const visible: IGetRepoDataResult[] = mode === 'other' && matchedBranch === undefined
      ? group.filter((result) => 'error' in result || (result.data.otherBranches?.length ?? 0) > 0)
      : group;
    if (visible.length === 0) {
      continue;
    }

    if (printedGroup) {
      terminal.writeLine();
    }

    printRepoDataAsTable(terminal, visible, mode, matchedBranch);
    printedGroup = true;
  }
}

export function printRepoDataAsTable(
  terminal: ITerminal,
  results: IGetRepoDataResult[],
  mode: BranchDisplayMode,
  matchedBranch?: string
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
      const { checkedOutBranch, otherBranches, branchIsCheckedOut } = data;
      if (matchedBranch !== undefined) {
        table.push([name, branchIsCheckedOut ? Colorize.green(matchedBranch) : matchedBranch]);
      } else {
        if (mode !== 'other') {
          table.push([name, mode === 'all' ? Colorize.green(checkedOutBranch) : checkedOutBranch]);
        }

        if (mode !== 'current' && otherBranches) {
          for (let index: number = 0; index < otherBranches.length; index++) {
            table.push([mode === 'other' && index === 0 ? name : '', otherBranches[index]]);
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
