// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Terminal } from '@rushstack/terminal';
import { CommandLineAction, ICommandLineActionOptions } from '@rushstack/ts-command-line';

import { LSBranchConfig } from '../../config/LSBranchConfig';
import { UpgradeMessagePrinter } from '../../util/UpgradeMessagePrinter';

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
    this._terminal = options.terminal;
    this._config = options.config;
  }

  protected override async onExecuteAsync(): Promise<void> {
    if (this._outputIsMachineReadable) {
      await this._executeInnerAsync();
    } else {
      const [upgradeMessagePrinter] = await Promise.all([
        UpgradeMessagePrinter.initializeAsync(this._config),
        this._executeInnerAsync()
      ]);
      await upgradeMessagePrinter.printUpgradeMessageAsync(this._terminal);
    }
  }

  protected abstract _executeInnerAsync(): Promise<void>;
}
