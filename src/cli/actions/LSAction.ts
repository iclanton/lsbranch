// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError, Colors, IColorableSequence, Terminal } from '@rushstack/node-core-library';
import { CommandLineAction, CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { ILSBranchConfigRepo, LSBranchConfig } from '../../config/LSBranchConfig';
import {
  getRepoDataAsync,
  IGetRepoDataErrorResult,
  IGetRepoDataResult,
  IGetRepoDataSuccessResult
} from '../../repoData/RepoData';

export interface ILSActionOptions {
  terminal: Terminal;
  configPath: string | undefined;
}

export class LSAction extends CommandLineAction {
  private _terminal: Terminal;
  private _configPath: string | undefined;
  private _jsonFlag!: CommandLineFlagParameter;

  public constructor(options: ILSActionOptions) {
    super({
      actionName: 'ls',
      summary: 'List branches.',
      documentation: ''
    });

    this._terminal = options.terminal;
    this._configPath = options.configPath;
  }

  public onDefineParameters(): void {
    this._jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If specified, present data in JSON format.'
    });
  }

  protected async onExecute(): Promise<void> {
    const config: LSBranchConfig = new LSBranchConfig(this._configPath);

    const configExists: boolean = await config.getConfigExistsAsync();
    if (!configExists) {
      const configPath: string = this._configPath || LSBranchConfig.getDefaultConfigPath();
      this._terminal.writeErrorLine(`Config file does not exist: ${configPath}`);
      throw new AlreadyReportedError();
    }

    const validationResult: boolean = await config.validateAsync(this._terminal);
    if (!validationResult) {
      this._terminal.writeErrorLine('Found config validation errors.');
      throw new AlreadyReportedError();
    }

    const repos: ILSBranchConfigRepo[] = await config.getConfigReposAsync();
    const reposData: IGetRepoDataResult[] = await Promise.all(repos.map((repo) => getRepoDataAsync(repo)));
    if (this._jsonFlag.value) {
      this._terminal.writeLine(JSON.stringify(reposData));
    } else {
      this._printDataAsTable(reposData);
    }
  }

  private _printDataAsTable(reposData: IGetRepoDataResult[]): void {
    let nameColumnLongestElementLength: number = 0;
    const rows: [string, string | IColorableSequence][] = [];
    for (const repoData of reposData) {
      const nameColumnContents: string = repoData.repo.alias || repoData.repo.path;

      const { error: getRepoDataError, data } = repoData as IGetRepoDataErrorResult &
        IGetRepoDataSuccessResult;
      let resultColumnContents: string | IColorableSequence;
      if (getRepoDataError) {
        resultColumnContents = Colors.red(getRepoDataError.message);
      } else if (data) {
        resultColumnContents = data.branchName;
      } else {
        throw new Error('Unexpected repo data result. Expected a "data" or "error" property.');
      }

      rows.push([nameColumnContents, resultColumnContents]);

      const nameColumnContentsLength: number = nameColumnContents.length;
      nameColumnLongestElementLength =
        nameColumnContentsLength > nameColumnLongestElementLength
          ? nameColumnContentsLength
          : nameColumnLongestElementLength;
    }

    const nameColumnWidth: number = nameColumnLongestElementLength + 2;

    for (const [nameColumnContents, dataColumnContents] of rows) {
      const nameColumnPaddingLength: number = nameColumnWidth - nameColumnContents.length;
      const nameColumnPadding: string = new Array(nameColumnPaddingLength + 1).join(' ');
      this._terminal.writeLine(nameColumnContents, nameColumnPadding, dataColumnContents);
    }
  }
}
