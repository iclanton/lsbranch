// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError } from '@rushstack/node-core-library';
import { Colorize } from '@rushstack/terminal';
import { CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync, IGetRepoDataResult } from '../../util/RepoData';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';
import { ADD_ACTION_NAME } from './AddAction';
import { LSBRANCH_TOOL_FILENAME } from '../LSBranchCommandLineParser';

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
    const { _config: config, _terminal: terminal } = this;
    const configExists: boolean = await config.getConfigExistsAsync();
    if (!configExists) {
      if (config.isDefaultConfigPath) {
        terminal.writeErrorLine(
          `No repos have been configured. Add a repo with "${LSBRANCH_TOOL_FILENAME} ${ADD_ACTION_NAME}"`
        );
      } else {
        terminal.writeErrorLine(`Config file does not exist: ${config.configPath}`);
      }

      throw new AlreadyReportedError();
    }

    const validationResult: boolean = await config.validateAsync(terminal);
    if (!validationResult) {
      terminal.writeErrorLine('Found config validation errors.');
      throw new AlreadyReportedError();
    }

    const repos: LSBranchConfigurationSchemaRepo[] = await config.getConfigReposAsync();
    const getAllBranches: boolean = this.#allFlag.value;
    const reposData: IGetRepoDataResult[] = await Promise.all(
      repos.map((repo) => getRepoDataAsync(repo, getAllBranches))
    );

    if (this.#jsonFlag.value) {
      terminal.writeLine(JSON.stringify(reposData));
    } else {
      this.#printDataAsTable(reposData, getAllBranches);
    }
  }

  #printDataAsTable(reposData: IGetRepoDataResult[], printCheckedOutBranchesInGreen: boolean): void {
    const { _terminal: terminal } = this;
    let nameColumnLongestElementLength: number = 0;
    const rows: [string, string[]][] = [];
    for (const repoData of reposData) {
      const { repo } = repoData;
      const { alias, path } = repo;
      let resultColumnContentsLines: string[];
      if ('error' in repoData) {
        const { error } = repoData;
        resultColumnContentsLines = [Colorize.red(error.message)];
      } else {
        const { data } = repoData;
        const { checkedOutBranch, otherBranches } = data;
        resultColumnContentsLines = [
          printCheckedOutBranchesInGreen ? Colorize.green(checkedOutBranch) : checkedOutBranch
        ];
        if (otherBranches) {
          for (const otherBranch of otherBranches) {
            resultColumnContentsLines.push(otherBranch);
          }
        }
      }

      const nameColumnLine: string = alias || path;
      rows.push([nameColumnLine, resultColumnContentsLines]);

      const nameColumnContentsLength: number = nameColumnLine.length;
      nameColumnLongestElementLength = Math.max(nameColumnContentsLength, nameColumnLongestElementLength);
    }

    const nameColumnWidth: number = nameColumnLongestElementLength + 2;
    const continuationPadding: string = ' '.repeat(nameColumnWidth);

    for (const [nameColumnContents, dataColumnContents] of rows) {
      for (let i = 0; i < dataColumnContents.length; i++) {
        if (i === 0) {
          const nameColumnPaddingLength: number = nameColumnWidth - nameColumnContents.length;
          const nameColumnPadding: string = ' '.repeat(nameColumnPaddingLength);
          terminal.writeLine(nameColumnContents, nameColumnPadding, dataColumnContents[i]);
        } else {
          terminal.writeLine(continuationPadding, dataColumnContents[i]);
        }
      }
    }
  }
}
