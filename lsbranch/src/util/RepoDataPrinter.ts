// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Colorize, ITerminal, TerminalTable } from '@rushstack/terminal';
import { IGetRepoDataResult } from './RepoData';

export type BranchDisplayMode = 'current' | 'all' | 'other';

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
      const { checkedOutBranch, otherBranches } = data;
      if (matchedBranch !== undefined) {
        table.push([name, checkedOutBranch === matchedBranch ? Colorize.green(matchedBranch) : matchedBranch]);
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
