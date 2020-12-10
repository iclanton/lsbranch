// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Terminal } from '@rushstack/node-core-library';
import { CommandLineAction, ICommandLineActionOptions } from '@rushstack/ts-command-line';

import { LSBranchConfig } from '../../config/LSBranchConfig';

export interface ILSBranchActionBaseOptions {
  terminal: Terminal;
  config: LSBranchConfig;
}

export abstract class LSBranchActionBase extends CommandLineAction {
  protected readonly _terminal: Terminal;
  protected readonly _config: LSBranchConfig;

  public constructor(options: ILSBranchActionBaseOptions, actionOptions: ICommandLineActionOptions) {
    super(actionOptions);
    this._terminal = options.terminal;
    this._config = options.config;
  }
}
