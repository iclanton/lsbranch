// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError } from '@rushstack/node-core-library';
import { CommandLineFlagParameter, IRequiredCommandLineStringParameter } from '@rushstack/ts-command-line';

import { IGetRepoDataResult } from '../../util/RepoData';
import { printRepoGroupsAsTable } from '../../util/RepoDataPrinter';
import { groupRepoResultsAsync } from '../../util/RepoGrouping';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';

export class FindAction extends LSBranchActionBase {
  readonly #branchParameter: IRequiredCommandLineStringParameter;
  readonly #jsonFlag: CommandLineFlagParameter;

  protected get _outputIsMachineReadable(): boolean {
    return this.#jsonFlag.value;
  }

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: 'find',
      summary: 'Find clones containing a local branch.',
      documentation: 'Matches local branch names using a shell-style glob, whether or not they are checked out.'
    });
    this.#branchParameter = this.defineStringParameter({
      parameterLongName: '--branch',
      argumentName: 'PATTERN',
      required: true,
      description: 'A local branch name or shell-style glob, for example "feature/**". Quote patterns to prevent shell expansion.'
    });

    this.#jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'Present matching clones and repository errors in JSON format.'
    });
  }

  protected override async _executeInnerAsync(): Promise<void> {
    const { _terminal: terminal } = this;
    const pattern: string = this.#branchParameter.value;
    if (!pattern) {
      terminal.writeErrorLine('The branch pattern must not be empty.');
      throw new AlreadyReportedError();
    }

    const results: IGetRepoDataResult[] = await this._getReposDataAsync(false, pattern);
    const groups: IGetRepoDataResult[][] = [];
    const matches: IGetRepoDataResult[] = [];
    for (const group of await groupRepoResultsAsync(results, terminal)) {
      const matchingGroup: IGetRepoDataResult[] = [];
      for (const result of group) {
        if ('error' in result || result.data.hasLocalBranch) {
          matchingGroup.push(result);
          matches.push(result);
        }
      }

      if (matchingGroup.length > 0) {
        groups.push(matchingGroup);
      }
    }

    if (this.#jsonFlag.value) {
      terminal.writeLine(JSON.stringify(matches));
    } else if (matches.length === 0) {
      terminal.writeLine(`No registered clones have local branches matching ${JSON.stringify(pattern)}.`);
    } else {
      printRepoGroupsAsTable(terminal, groups, 'current', true);
    }
  }
}
