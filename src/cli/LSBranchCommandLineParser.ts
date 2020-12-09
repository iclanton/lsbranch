// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineParser } from '@rushstack/ts-command-line';
import { Terminal, ConsoleTerminalProvider } from '@rushstack/node-core-library';

import { LSAction } from './actions/LSAction';

export class LSBranchCommandLineParser extends CommandLineParser {
  private _terminal: Terminal;

  public get terminal(): Terminal {
    return this._terminal;
  }

  public constructor() {
    super({
      toolFilename: 'lsbranch',
      toolDescription: 'LSBranch is a simple tool for listing the active branches in git clones.'
    });

    this._terminal = new Terminal(new ConsoleTerminalProvider());

    this.addAction(new LSAction(this.terminal));
  }

  protected onDefineParameters(): void {
    // No parameters
  }

  protected async onExecute(): Promise<void> {}
}
