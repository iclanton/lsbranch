// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError } from '@rushstack/node-core-library';
import { CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { IGetRepoDataResult } from '../../util/RepoData';
import { BranchDisplayMode, printRepoDataAsTable } from '../../util/RepoDataPrinter';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';

export class LSAction extends LSBranchActionBase {
  readonly #jsonFlag: CommandLineFlagParameter;
  readonly #allFlag: CommandLineFlagParameter;
  readonly #otherFlag: CommandLineFlagParameter;

  protected get _outputIsMachineReadable(): boolean {
    return this.#jsonFlag.value;
  }

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, { actionName: 'ls', summary: 'List branches.', documentation: '' });
    this.#jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If specified, present data in JSON format.'
    });

    this.#allFlag = this.defineFlagParameter({
      parameterLongName: '--all',
      parameterShortName: '-a',
      description: 'If specified, display all local branches.'
    });

    this.#otherFlag = this.defineFlagParameter({
      parameterLongName: '--other',
      description: 'List only local branches that are not checked out in each clone.'
    });
  }

  protected override async _executeInnerAsync(): Promise<void> {
    const { _terminal: terminal } = this;
    if (this.#allFlag.value && this.#otherFlag.value) {
      terminal.writeErrorLine('Specify only one of --all or --other.');
      throw new AlreadyReportedError();
    }

    const mode: BranchDisplayMode = this.#otherFlag.value ? 'other' : this.#allFlag.value ? 'all' : 'current';
    const results: IGetRepoDataResult[] = await this._getReposDataAsync(mode !== 'current');
    if (this.#jsonFlag.value) {
      if (mode === 'other') {
        terminal.writeLine(JSON.stringify(results.map((result) => {
          if ('error' in result) {
            return result;
          }

          const { repo, data: { otherBranches } } = result;
          return { repo, data: { otherBranches } };
        })));
      } else {
        terminal.writeLine(JSON.stringify(results));
      }
    } else {
      printRepoDataAsTable(terminal, results, mode);
    }
  }
}
