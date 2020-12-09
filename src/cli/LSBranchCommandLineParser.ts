// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineParser, CommandLineStringParameter } from '@rushstack/ts-command-line';
import { Terminal, ConsoleTerminalProvider, AlreadyReportedError } from '@rushstack/node-core-library';

import { LSAction } from './actions/LSAction';

export class LSBranchCommandLineParser extends CommandLineParser {
  private _terminal: Terminal;
  private _configPathParameter!: CommandLineStringParameter;

  public get terminal(): Terminal {
    return this._terminal;
  }

  public constructor() {
    super({
      toolFilename: 'lsbranch',
      toolDescription: 'LSBranch is a simple tool for listing the active branches in git clones.'
    });

    this._terminal = new Terminal(new ConsoleTerminalProvider());

    this.addAction(new LSAction({ terminal: this.terminal, configPath: this._configPathParameter.value }));
  }

  protected onDefineParameters(): void {
    this._configPathParameter = this.defineStringParameter({
      parameterLongName: '--config',
      parameterShortName: '-c',
      argumentName: 'PATH',
      description: 'Override the config file path. Defaults to ~/.lsbranch.json'
    });
  }

  protected async onExecute(): Promise<void> {
    process.exitCode = 1;
    try {
      await super.onExecute();
      process.exitCode = 0;
    } catch (e) {
      if (!(e instanceof AlreadyReportedError)) {
        this.terminal.writeErrorLine(`An unexpected error occurred: ${e}`);
      }
    }
  }
}
