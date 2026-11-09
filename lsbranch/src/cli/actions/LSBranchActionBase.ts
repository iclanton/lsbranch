// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Terminal } from '@rushstack/terminal';
import { AlreadyReportedError, Async } from '@rushstack/node-core-library';
import { CommandLineAction, ICommandLineActionOptions } from '@rushstack/ts-command-line';

import { LSBranchConfig, LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { UpgradeMessagePrinter } from '../../util/UpgradeMessagePrinter';
import { getRepoDataAsync, IGetRepoDataResult } from '../../util/RepoData';
import { LSBRANCH_TOOL_FILENAME } from '../LSBranchCommandLineParser';

export const ADD_ACTION_NAME: string = 'add';
export const PATH_PARAMETER_NAME: string = '--path';
export const ALIAS_PARAMETER_NAME: string = '--alias';

export interface ILSBranchActionBaseOptions {
  terminal: Terminal;
  config: LSBranchConfig;
}

export abstract class LSBranchActionBase extends CommandLineAction {
  protected readonly _terminal: Terminal;
  protected readonly _config: LSBranchConfig;

  protected abstract readonly _outputIsMachineReadable: boolean;

  public constructor(options: ILSBranchActionBaseOptions, actionOptions: ICommandLineActionOptions) {
    super(actionOptions);
    const { terminal, config } = options;
    this._terminal = terminal;
    this._config = config;
  }

  protected override async onExecuteAsync(): Promise<void> {
    const { _config: config, _terminal: terminal } = this;
    if (this._outputIsMachineReadable) {
      await this._executeInnerAsync();
    } else {
      const [upgradeMessagePrinter] = await Promise.all([
        UpgradeMessagePrinter.initializeAsync(config),
        this._executeInnerAsync()
      ]);
      await upgradeMessagePrinter.printUpgradeMessageAsync(terminal);
    }
  }

  protected async _getConfiguredReposAsync(): Promise<LSBranchConfigurationSchemaRepo[]> {
    const { _config: config, _terminal: terminal } = this;
    if (!(await config.getConfigExistsAsync())) {
      if (config.isDefaultConfigPath) {
        terminal.writeErrorLine(`No repos have been configured. Add a repo with "${LSBRANCH_TOOL_FILENAME} ${ADD_ACTION_NAME}"`);
      } else {
        terminal.writeErrorLine(`Config file does not exist: ${config.configPath}`);
      }

      throw new AlreadyReportedError();
    }

    if (!(await config.validateAsync(terminal))) {
      terminal.writeErrorLine('Found config validation errors.');
      throw new AlreadyReportedError();
    }

    return config.getConfigReposAsync();
  }

  protected async _getReposDataAsync(getAllBranches: boolean, branchName?: string): Promise<IGetRepoDataResult[]> {
    const repos: LSBranchConfigurationSchemaRepo[] = await this._getConfiguredReposAsync();
    return Async.mapAsync(
      repos,
      (repo) => branchName === undefined
        ? getRepoDataAsync(repo, getAllBranches)
        : getRepoDataAsync(repo, getAllBranches, branchName),
      { concurrency: 15 }
    );
  }

  protected abstract _executeInnerAsync(): Promise<void>;
}
