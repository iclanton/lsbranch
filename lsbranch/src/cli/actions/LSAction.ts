// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError, Async } from '@rushstack/node-core-library';
import { Colorize, TerminalTable } from '@rushstack/terminal';
import { CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync, IGetRepoDataResult } from '../../util/RepoData';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';
import { ADD_ACTION_NAME } from './AddAction';
import { LSBRANCH_TOOL_FILENAME } from '../LSBranchCommandLineParser';

const REPO_LOOKUP_CONCURRENCY: number = 15;

export class LSAction extends LSBranchActionBase {
  readonly #jsonFlag: CommandLineFlagParameter;
  readonly #allFlag: CommandLineFlagParameter;
  readonly #otherFlag: CommandLineFlagParameter;

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

    this.#otherFlag = this.defineFlagParameter({
      parameterLongName: '--other',
      description: 'List only local branches that are not checked out in each clone.'
    });
  }

  protected override async _executeInnerAsync(): Promise<void> {
    const { _config: config, _terminal: terminal } = this;
    if (this.#allFlag.value && this.#otherFlag.value) {
      terminal.writeErrorLine('Specify only one of --all or --other.');
      throw new AlreadyReportedError();
    }

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
    const getAllBranches: boolean = this.#allFlag.value || this.#otherFlag.value;
    const reposData: IGetRepoDataResult[] = await Async.mapAsync(
      repos,
      (repo) => getRepoDataAsync(repo, getAllBranches),
      { concurrency: REPO_LOOKUP_CONCURRENCY }
    );

    if (this.#jsonFlag.value) {
      if (this.#otherFlag.value) {
        terminal.writeLine(JSON.stringify(reposData.map((result) => {
            if ('error' in result) {
              return result;
            }

            const { repo, data: { otherBranches } } = result;
            return { repo, data: { otherBranches } };
          })));
      } else {
        terminal.writeLine(JSON.stringify(reposData));
      }
    } else {
      this.#printDataAsTable(reposData, getAllBranches);
    }
  }

  #printDataAsTable(reposData: IGetRepoDataResult[], printCheckedOutBranchesInGreen: boolean): void {
    const { _terminal: terminal } = this;
    const table: TerminalTable = new TerminalTable({ borderless: true });
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
        resultColumnContentsLines = this.#otherFlag.value ? [] : [
          printCheckedOutBranchesInGreen ? Colorize.green(checkedOutBranch) : checkedOutBranch
        ];
        if (otherBranches) {
          for (const otherBranch of otherBranches) {
            resultColumnContentsLines.push(otherBranch);
          }
        }
      }

      const nameColumnLine: string = alias || path;
      for (let i = 0; i < resultColumnContentsLines.length; i++) {
        table.push([i === 0 ? nameColumnLine : '', resultColumnContentsLines[i]]);
      }
    }

    for (const line of table.getLines()) {
      // Remove cell padding at the table edges to preserve the existing flush-left layout.
      terminal.writeLine(line.slice(1).trimEnd());
    }
  }
}
