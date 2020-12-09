// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Terminal } from '@rushstack/node-core-library';
import { CommandLineAction } from '@rushstack/ts-command-line';

export class LSAction extends CommandLineAction {
  private _terminal: Terminal;

  public constructor(terminal: Terminal) {
    super({
      actionName: 'ls',
      summary: 'List branches.',
      documentation: ''
    });

    this._terminal = terminal;
  }

  public onDefineParameters(): void {
    // No parameters
  }

  protected async onExecute(): Promise<void> {}
}
