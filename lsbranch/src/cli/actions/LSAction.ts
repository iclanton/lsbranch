// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { IGetRepoDataResult } from '../../util/RepoData';
import { BranchDisplayMode, printRepoGroupsAsTable } from '../../util/RepoDataPrinter';
import { groupRepoResultsAsync } from '../../util/RepoGrouping';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';

export class LSAction extends LSBranchActionBase {
  readonly #jsonFlag: CommandLineFlagParameter;
  readonly #allFlag: CommandLineFlagParameter;

  protected get _outputIsMachineReadable(): boolean {
    return this.#jsonFlag.value;
  }

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: 'ls',
      summary: 'List branches.',
      documentation: ''
    });

    this.#jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If specified, present data in JSON format.'
    });

    this.#allFlag = this.defineFlagParameter({
      parameterLongName: '--all',
      parameterShortName: '-a',
      description: 'If specified, display all local branches.'
    });

  }

  protected override async _executeInnerAsync(): Promise<void> {
    const { _terminal: terminal } = this;
    const mode: BranchDisplayMode = this.#allFlag.value ? 'all' : 'current';
    const results: IGetRepoDataResult[] = await this._getReposDataAsync(mode !== 'current');
    const groups: IGetRepoDataResult[][] = await groupRepoResultsAsync(results, terminal);
    if (this.#jsonFlag.value) {
      terminal.writeLine(JSON.stringify(groups.flat()));
    } else {
      printRepoGroupsAsTable(terminal, groups, mode);
    }
  }
}
