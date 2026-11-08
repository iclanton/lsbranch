// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError } from '@rushstack/node-core-library';
import { CommandLineFlagParameter, IRequiredCommandLineStringParameter } from '@rushstack/ts-command-line';

import { isValidLocalBranchName } from '../../util/GitRepository';
import { IGetRepoDataResult } from '../../util/RepoData';
import { printRepoDataAsTable } from '../../util/RepoDataPrinter';
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
      documentation: 'Matches an exact local branch name, whether or not it is checked out.'
    });
    this.#branchParameter = this.defineStringParameter({
      parameterLongName: '--branch',
      argumentName: 'NAME',
      required: true,
      description: 'The exact local branch name to find.'
    });

    this.#jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'Present matching clones and repository errors in JSON format.'
    });
  }

  protected override async _executeInnerAsync(): Promise<void> {
    const { _terminal: terminal } = this;
    const branch: string = this.#branchParameter.value;
    if (!isValidLocalBranchName(branch)) {
      terminal.writeErrorLine(`Invalid local branch name: ${JSON.stringify(branch)}`);
      throw new AlreadyReportedError();
    }

    const results: IGetRepoDataResult[] = await this._getReposDataAsync(false, branch);
    const matches: IGetRepoDataResult[] = results.filter((result) =>
      'error' in result || result.data.hasLocalBranch
    );
    if (this.#jsonFlag.value) {
      terminal.writeLine(JSON.stringify(matches));
    } else if (matches.length === 0) {
      terminal.writeLine(`No registered clones have local branch "${branch}".`);
    } else {
      printRepoDataAsTable(terminal, matches, 'current', branch);
    }
  }
}
